# Chain records

Run `pnpm db:migrate` after setting `DATABASE_URL` in the local `.env` file. Use a dedicated PostgreSQL database for this project. The command never prints the connection string.

The runner applies numbered SQL files in order, inside one transaction. It locks the migration history while applying changes. Repeating the command skips unchanged files. Editing a previously applied file fails; add a new migration instead. A failed migration rolls back all changes from that run.

The first migration stores blocks, transactions, original receipts, Chog metadata, transfers, classifications, payments, wallet checks, ownership history and indexing progress. Addresses and hashes use lowercase hex. Payment amounts are whole wei stored as exact decimal integers. Unknown bundle prices remain absent. A sale requires a classified sale record, and gross payment must equal seller proceeds plus fees.

Ownership arrivals and departures must match the token, address and time in their source transfers. The database permits one current owner per token. The indexer must insert source records before records that depend on them, in one transaction, then advance its progress in that same transaction.

`pnpm test` runs the migrations in an embedded PostgreSQL engine without network access. The database tests use a saved real Monad transaction, its receipt, block and Chog metadata. These records are test evidence, not a playable case.

This database change does not deploy PostgreSQL, import the full history or finish the event classifier. Those steps follow the schema and payment checks. Back up an existing database before applying later changes; there is no automatic destructive rollback command.

## Import the saved history

Run `pnpm backfill --related` and `pnpm mirror-art` to collect the public records, then `pnpm db:import` to migrate and import them into the configured PostgreSQL database. `pnpm db:import --local-check` runs the same import in a temporary offline PostgreSQL database and writes a check report under the ignored `runs/checks/` folder.

The import keeps original HyperSync request details and fetch times. A HyperSync reply is stored as its own source record; it is never presented as an RPC receipt. Transfers keep their original logs. Fulfilled-order logs and the inputs to calculated facts remain attached to each classification.

Repeating the same import preserves records. A conflicting block, transaction, metadata record or classification fails and rolls back the whole import. Derived ownership periods are rebuilt within that transaction. A transfer to the same wallet does not restart its holding period. The saved progress records the last imported event block, separately from the source scan boundary; the importer does not claim to have checked unrecorded blocks.

`pnpm data:classify` writes the classifications, ownership periods, calculated facts and review list from the saved history. Unknown movements remain excluded from case answers. A direct transfer does not establish whether the owner intended a gift or controlled both wallets.

## Escrow and payment checks

Run `pnpm data:escrow`, then `pnpm data:escrow-traces` before classifying or importing the full saved history. The escrow source must cover the NFT snapshot. The importer keeps deal creation, seller payment and collection separate. MON payments require matching successful execution calls; $CHOG and WMON payments require matching logs from their official token contracts. Escrow payments do not enter the Seaport-only market-price reference.

Use `pnpm db:import --reclassify` when deliberately rebuilding derived classifications after a classifier change or new payment evidence. This clears and rebuilds the affected classifications, sales and escrow movements in one transaction. It preserves original blocks, transactions and transfer logs. Ordinary repeated imports still reject source conflicts.

For a specific transfer, run `pnpm data:payment-window --tx <transaction hash> --log-index <log index>`. Create a key at [Etherscan](https://etherscan.io/myapikey) and save `ETHERSCAN_API_KEY` in the local `.env` file. The key is never included in saved requests. The checker reads complete external MON, internal MON and official WMON histories for one hour on either side of the transfer, with source blocks enclosing the entire interval. The window must have closed and confirmed. Missing pages, API errors, wrong wallets, wrong token contracts and incomplete history cannot produce a no-payment result. Positive account-history findings require a matching successful receipt and execution calls or official token logs before they are treated as confirmed payments.

Verified window results under `data/payment-windows/` are rechecked and included in the next history import. Unchecked transfers remain explicitly marked as not checked. A no-payment result covers the stated assets and interval; it does not establish gift intent or common wallet control.

Regenerate the new offline evidence with `pnpm fixtures:escrow` and `pnpm fixtures:payments`. The fixtures contain real public replies and no credentials. [Envio's trace documentation](https://docs.envio.dev/docs/HyperSync/tutorial-decoding-traces) explains why the ordinary log endpoint cannot establish the absence of internal native payments. [Etherscan's account-history endpoint](https://docs.etherscan.io/api-reference/endpoint/txlistinternal) provides the separately paginated internal records used here.
