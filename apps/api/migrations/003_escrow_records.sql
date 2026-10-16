ALTER TABLE events_classified DROP CONSTRAINT events_classified_classification_check;
ALTER TABLE events_classified ADD CONSTRAINT events_classified_classification_check
  CHECK (classification IN ('MINT','BURN','SALE','SEAPORT_NO_PAYMENT','BULK_MOVE',
    'SMART_WALLET_ACTION','PLAIN_TRANSFER','ROUTER_MOVE','UNCLASSIFIED','ESCROW_DEPOSIT','ESCROW_COLLECTION'));
CREATE TABLE escrow_deals (
  deal_id numeric(78,0) PRIMARY KEY CHECK (deal_id > 0),
  token_id integer NOT NULL REFERENCES chogs(token_id),
  buyer text NOT NULL CHECK (buyer ~ '^0x[0-9a-f]{40}$'),
  payment_token text NOT NULL CHECK (payment_token ~ '^0x[0-9a-f]{40}$'),
  amount_wei wei_amount NOT NULL CHECK (amount_wei > 0),
  created jsonb NOT NULL,
  sold jsonb,
  collected jsonb,
  cancelled jsonb,
  CHECK (collected IS NULL OR sold IS NOT NULL),
  CHECK (cancelled IS NULL OR (sold IS NULL AND collected IS NULL))
);
CREATE TABLE escrow_movements (
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  deal_id numeric(78,0) NOT NULL REFERENCES escrow_deals(deal_id),
  role text NOT NULL CHECK (role IN ('deposit','collection')),
  proof jsonb NOT NULL,
  PRIMARY KEY (tx_hash,log_index),
  UNIQUE (deal_id,role),
  FOREIGN KEY (tx_hash,log_index) REFERENCES transfers(tx_hash,log_index)
);
ALTER TABLE escrow_movements ADD CONSTRAINT escrow_classified_event
  FOREIGN KEY (tx_hash,log_index) REFERENCES events_classified(tx_hash,log_index);
CREATE FUNCTION require_escrow_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM events_classified e JOIN transfers t USING (tx_hash,log_index)
    JOIN escrow_deals d ON d.deal_id=NEW.deal_id
    WHERE e.tx_hash=NEW.tx_hash AND e.log_index=NEW.log_index AND t.token_id=d.token_id
      AND e.classification=CASE WHEN NEW.role='deposit' THEN 'ESCROW_DEPOSIT' ELSE 'ESCROW_COLLECTION' END
    FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'DATA_ESCROW_CLASS: Deal does not match the classified NFT movement'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER escrow_classification BEFORE INSERT OR UPDATE ON escrow_movements
  FOR EACH ROW EXECUTE FUNCTION require_escrow_classification();
CREATE FUNCTION preserve_escrow_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM escrow_movements m WHERE m.tx_hash=OLD.tx_hash AND m.log_index=OLD.log_index
    AND NEW.classification<>CASE WHEN m.role='deposit' THEN 'ESCROW_DEPOSIT' ELSE 'ESCROW_COLLECTION' END) THEN
    RAISE EXCEPTION 'DATA_ESCROW_CLASS: Remove deal movement before changing classification';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER escrow_classification_update BEFORE UPDATE ON events_classified
  FOR EACH ROW EXECUTE FUNCTION preserve_escrow_classification();
