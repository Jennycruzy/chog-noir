ALTER TABLE chain_transactions ADD COLUMN source_record jsonb;
UPDATE chain_transactions SET source_record = jsonb_build_object(
  'provider', 'RPC', 'fetchedAt', fetched_at, 'receipt', receipt
);
ALTER TABLE chain_transactions ALTER COLUMN source_record SET NOT NULL;
ALTER TABLE chain_transactions ALTER COLUMN receipt DROP NOT NULL;
ALTER TABLE chain_transactions ADD CONSTRAINT transaction_source_object
  CHECK (jsonb_typeof(source_record) = 'object' AND source_record ? 'provider' AND source_record ? 'fetchedAt');
