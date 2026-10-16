CREATE DOMAIN wei_amount AS numeric CHECK (VALUE >= 0 AND scale(VALUE) = 0 AND VALUE < power(10::numeric, 78));

CREATE TABLE chain_blocks (
  number bigint PRIMARY KEY CHECK (number >= 0),
  hash text NOT NULL UNIQUE CHECK (hash ~ '^0x[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL
);

CREATE TABLE chain_transactions (
  hash text PRIMARY KEY CHECK (hash ~ '^0x[0-9a-f]{64}$'),
  block_number bigint NOT NULL REFERENCES chain_blocks(number),
  signer text NOT NULL CHECK (signer ~ '^0x[0-9a-f]{40}$'),
  destination text CHECK (destination ~ '^0x[0-9a-f]{40}$'),
  input text NOT NULL CHECK (input ~ '^0x([0-9a-f]{2})*$'),
  value_wei wei_amount NOT NULL CHECK (value_wei >= 0),
  receipt jsonb NOT NULL,
  fetched_at timestamptz NOT NULL
);

CREATE TABLE chogs (
  token_id integer PRIMARY KEY CHECK (token_id BETWEEN 1 AND 1969),
  metadata_uri text NOT NULL,
  metadata_name text NOT NULL,
  image_uri text NOT NULL,
  metadata jsonb NOT NULL,
  metadata_fetched_at timestamptz NOT NULL
);

CREATE TABLE transfers (
  tx_hash text NOT NULL REFERENCES chain_transactions(hash),
  log_index integer NOT NULL CHECK (log_index >= 0),
  token_id integer NOT NULL REFERENCES chogs(token_id),
  from_address text NOT NULL CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
  to_address text NOT NULL CHECK (to_address ~ '^0x[0-9a-f]{40}$'),
  raw_log jsonb NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX transfers_token ON transfers(token_id);
CREATE INDEX transfers_sender ON transfers(from_address);
CREATE INDEX transfers_receiver ON transfers(to_address);

CREATE TABLE events_classified (
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  classification text NOT NULL CHECK (classification IN (
    'MINT', 'BURN', 'SALE', 'SEAPORT_NO_PAYMENT', 'BULK_MOVE',
    'SMART_WALLET_ACTION', 'PLAIN_TRANSFER', 'ROUTER_MOVE', 'UNCLASSIFIED'
  )),
  rule text NOT NULL,
  reason text NOT NULL CHECK (length(reason) > 0),
  evidence jsonb NOT NULL,
  classifier_version integer NOT NULL CHECK (classifier_version > 0),
  classified_at timestamptz NOT NULL,
  PRIMARY KEY (tx_hash, log_index),
  FOREIGN KEY (tx_hash, log_index) REFERENCES transfers(tx_hash, log_index)
);

CREATE TABLE sales (
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  route text NOT NULL CHECK (route IN ('offer_accepted', 'listing_bought')),
  asset text NOT NULL CHECK (asset IN ('MON', 'WMON')),
  gross_wei wei_amount,
  seller_proceeds_wei wei_amount,
  fees_wei wei_amount,
  price_status text NOT NULL CHECK (price_status IN ('EXACT', 'PRICE_BUNDLE')),
  payment_evidence jsonb NOT NULL,
  PRIMARY KEY (tx_hash, log_index),
  FOREIGN KEY (tx_hash, log_index) REFERENCES events_classified(tx_hash, log_index),
  CHECK (
    (price_status = 'EXACT' AND gross_wei IS NOT NULL
      AND seller_proceeds_wei IS NOT NULL AND fees_wei IS NOT NULL
      AND gross_wei > 0 AND seller_proceeds_wei > 0
      AND fees_wei >= 0 AND gross_wei = seller_proceeds_wei + fees_wei)
    OR (price_status = 'PRICE_BUNDLE' AND gross_wei IS NULL
      AND seller_proceeds_wei IS NULL AND fees_wei IS NULL)
  )
);


CREATE TABLE wallets (
  address text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  kind text NOT NULL CHECK (kind IN ('PLAIN', 'SMART_7702', 'CONTRACT', 'UNKNOWN')),
  checked_block bigint NOT NULL REFERENCES chain_blocks(number),
  evidence jsonb NOT NULL,
  fetched_at timestamptz NOT NULL
);

CREATE TABLE owners_timeline (
  token_id integer NOT NULL REFERENCES chogs(token_id),
  arrival_tx text NOT NULL,
  arrival_log_index integer NOT NULL,
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  arrived_at timestamptz NOT NULL,
  departure_tx text,
  departure_log_index integer,
  departed_at timestamptz,
  PRIMARY KEY (token_id, arrival_tx, arrival_log_index),
  FOREIGN KEY (arrival_tx, arrival_log_index) REFERENCES transfers(tx_hash, log_index),
  FOREIGN KEY (departure_tx, departure_log_index) REFERENCES transfers(tx_hash, log_index),
  CHECK ((departure_tx IS NULL AND departure_log_index IS NULL AND departed_at IS NULL)
    OR (departure_tx IS NOT NULL AND departure_log_index IS NOT NULL
      AND departed_at IS NOT NULL AND departed_at >= arrived_at))
);
CREATE UNIQUE INDEX owners_current ON owners_timeline(token_id) WHERE departed_at IS NULL;
CREATE INDEX owners_wallet ON owners_timeline(owner_address);

CREATE TABLE indexer_progress (
  stream text PRIMARY KEY CHECK (length(stream) > 0),
  last_block bigint NOT NULL REFERENCES chain_blocks(number),
  updated_at timestamptz NOT NULL
);

CREATE FUNCTION require_sale_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM events_classified WHERE tx_hash = NEW.tx_hash
    AND log_index = NEW.log_index AND classification = 'SALE' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DATA_SALE_CLASS: Payment record requires a classified sale';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_classification BEFORE INSERT OR UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION require_sale_classification();

CREATE FUNCTION preserve_sale_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.classification <> 'SALE' AND EXISTS (SELECT 1 FROM sales
    WHERE tx_hash = OLD.tx_hash AND log_index = OLD.log_index) THEN
    RAISE EXCEPTION 'DATA_SALE_CLASS: Remove payment record before changing classification';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER classified_sale_update BEFORE UPDATE ON events_classified
  FOR EACH ROW EXECUTE FUNCTION preserve_sale_classification();

CREATE FUNCTION validate_owner_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM chogs WHERE token_id = NEW.token_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM transfers t
    JOIN chain_transactions x ON x.hash=t.tx_hash
    JOIN chain_blocks b ON b.number=x.block_number
    WHERE t.tx_hash=NEW.arrival_tx AND t.log_index=NEW.arrival_log_index
      AND t.token_id=NEW.token_id AND t.to_address=NEW.owner_address
      AND b.occurred_at=NEW.arrived_at) THEN
    RAISE EXCEPTION 'DATA_OWNER_SOURCE: Arrival does not match the stored transfer';
  END IF;
  IF NEW.departure_tx IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transfers t
    JOIN chain_transactions x ON x.hash=t.tx_hash
    JOIN chain_blocks b ON b.number=x.block_number
    WHERE t.tx_hash=NEW.departure_tx AND t.log_index=NEW.departure_log_index
      AND t.token_id=NEW.token_id AND t.from_address=NEW.owner_address
      AND b.occurred_at=NEW.departed_at) THEN
    RAISE EXCEPTION 'DATA_OWNER_SOURCE: Departure does not match the stored transfer';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER owner_record_source BEFORE INSERT OR UPDATE ON owners_timeline
  FOR EACH ROW EXECUTE FUNCTION validate_owner_record();
