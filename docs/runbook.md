# Running Chog Noir

Everything runs on the VPS from `/home/ubuntu/chog-noir-release/current`, a detached worktree of a
tested commit. Shared runtime state (`runs/`, `data/`, `.env`) lives in the main checkout and is
linked into every release.

## Services

| Unit | When | What it does |
| --- | --- | --- |
| `chog-noir-api.service` | always | The game API on `127.0.0.1:8311`, behind Nginx |
| `chog-noir-daily.timer` | every 5 minutes | Closes yesterday's case (reveal, cast, results), builds today's, locks it on chain and publishes it at 00:20 UTC; resumes from its journal after any failure |
| `chog-noir-siren.service` | always | Reads finalized Chog sales into the live ticker |
| `chog-noir-owners.service` | always | Keeps the owner index within a minute of the chain; sign-in needs it fresh |
| `chog-noir-cleanup.timer` | 00:20 and 02:10 UTC | Closes the Rookie desk at case open; removes spent sign-in records |
| `chog-noir-alerts.timer` | every 5 minutes | Writes current alerts for `/health` and sends them to Telegram when configured |
| `chog-noir-backup.timer` | 03:10 UTC | Backs up private runtime state and proves the newest copy restores |

Unit files are in `config/`. `sudo systemctl status <unit>` shows state; `journalctl -u <unit>` shows logs.

## Health

`/health` reports the daily status and case id, whether a case is open, the last lock
transaction, the owner index block and age, saved history coverage and the current alert codes.

Alerts: `CASE_NOT_PUBLISHED` (after 00:25 UTC), `OWNER_INDEX_LAG` (over 10 minutes),
`LIVE_DOWN` (over 2 minutes), `SIGNER_LOW` (under 0.5 MON), `SOLVES_RECORD_FAIL` (results not
on chain two hours after close), `FALLBACK_POOL_LOW` (fewer than seven cold cases left). Set
`ALERT_TELEGRAM_TOKEN` and `ALERT_TELEGRAM_CHAT` in `.env` to receive them.

## The chain

The server signer only pays gas. `EXECUTION_WRITES_ENABLED` in `.env` is the kill switch: with
it off the daily run still builds and seals each case, reports `READY_TO_COMMIT`, and writes
nothing. Every transaction is signed once, journaled before broadcast under
`runs/chain/transactions`, and resumed from the journal after a restart; a stuck transaction is
replaced only with the same intent and nonce.

- Deploy CaseBook: `EXECUTION_WRITES_ENABLED=true corepack pnpm chain:deploy` (deploys, checks the
  runtime bytecode, verifies the source and records the address in `.env`).
- Check a case: `corepack pnpm verify <case id>`.

## Releases

Commit, then run `bash scripts/deploy-release.sh <full sha>` under systemd as `ubuntu`. It builds
a worktree, installs the frozen lockfile, runs every check (types, Foundry, all tests, the smoke
check, the private-file scan, the browser on a phone and by keyboard) and only then switches the
site and API. Roll back by pointing `chog-noir-release/current` and `/var/www/chog-noir` at the
previous release and restarting the API. Never restore older runtime state with a rollback.

## Backups

`scripts/backup.sh` writes `/home/ubuntu/chog-noir-backups/runtime-<time>.tar.gz` (mode 600,
fourteen kept): published cases and their encrypted keys, careers, case plays, transaction
journals, the daily plan, alert subscriptions, opt-outs, burn records and hunches, with the vault
key and `.env`. `corepack pnpm exec tsx scripts/restore-check.mts` restores the newest copy into
a scratch directory and checks every case decrypts and still matches its on-chain hash.

## Opt-outs

A signed-in wallet can opt out at `/api/optout`. From then on the daily build skips any event
whose sale, or any witness's holder, involves that wallet.

## Rebuilding the training case

`corepack pnpm exec tsx scripts/build-training.mts` rebuilds Case #0 and the front-door replay
from an archived real sale at least a week old.
