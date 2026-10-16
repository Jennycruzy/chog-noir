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
