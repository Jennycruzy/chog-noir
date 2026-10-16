# Chain records

Run `pnpm db:migrate` after setting `DATABASE_URL` in the local `.env` file. Use a dedicated PostgreSQL database for this project. The command never prints the connection string.

The runner applies numbered SQL files in order, inside one transaction. It locks the migration history while applying changes. Repeating the command skips unchanged files. Editing a previously applied file fails; add a new migration instead. A failed migration rolls back all changes from that run.

The first migration stores blocks, transactions, original receipts, Chog metadata, transfers, classifications, payments, wallet checks, ownership history and indexing progress. Addresses and hashes use lowercase hex. Payment amounts are whole wei stored as exact decimal integers. Unknown bundle prices remain absent. A sale requires a classified sale record, and gross payment must equal seller proceeds plus fees.

Ownership arrivals and departures must match the token, address and time in their source transfers. The database permits one current owner per token. The indexer must insert source records before records that depend on them, in one transaction, then advance its progress in that same transaction.

`pnpm test` runs the migrations in an embedded PostgreSQL engine without network access. The database tests use a saved real Monad transaction, its receipt, block and Chog metadata. These records are test evidence, not a playable case.

This database change does not deploy PostgreSQL, import the full history or finish the event classifier. Those steps follow the schema and payment checks. Back up an existing database before applying later changes; there is no automatic destructive rollback command.
