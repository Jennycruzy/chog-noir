# Chog Noir VPS

Use `ubuntu@54.154.121.30` as the project's execution host. The full checkout lives at `/home/ubuntu/chog-noir-monitor`; the existing directory name is retained so deployed services and saved report paths remain valid. It includes Git history, application and package source, contracts, scripts, configuration, mirrored artwork and metadata, source data, and saved runs. Keep long work on this VPS, independent of the local computer.

Dependencies are installed for Linux from `pnpm-lock.yaml` using `corepack pnpm install --frozen-lockfile`. Run project commands from the checkout using `corepack pnpm`. The private build instructions live separately at `/home/ubuntu/chognoir-private`, outside Git. Project credentials are stored in a mode-600 `.env`; they are never committed. The migration preserves existing VPS settings and backs up its previous environment file privately.

The `chog-noir-api.service` systemd service serves the archive game API and starts at boot. Nginx serves the public preview at https://chognoir.54-154-121-30.sslip.io/ and proxies `/api/` and `/health`. The local computer and SSH session can be turned off without stopping these services. This is archive play, not a live daily case or continuous indexer.

The API loads the validated private archive at startup, then stores guest sessions
in ignored `runs/game-sessions/`. `corepack pnpm game:web` assembles HTML, JavaScript,
CSS and only the required original portraits under `runs/game-preview/web/`.
Nginx serves a copy of that public-only bundle from `/var/www/chog-noir`; it has no
route to the source archive, metadata, environment or session files. Preserve the
host's existing Certbot TLS directives when updating Nginx. The archive and session files remain private.

Use systemd for long jobs, with an explicit working directory and a persistent output directory under `runs/`. A plain foreground SSH command can stop when its connection closes. The `chog-noir-reliability.service` runs as `ubuntu`, with its own working directory and a six-hour duration, independently of SSH.

Check service state with `sudo systemctl status chog-noir-reliability.service` and logs with `sudo journalctl -u chog-noir-reliability.service`. Progress and reports are saved under `/home/ubuntu/chog-noir-monitor/runs/reliability-vps/` as `run-summary.json`, `snapshot.json`, source pages and the final `reliability-report.json`.

This is a single observation run. The service does not automatically restart failed runs or start at boot. A stopped or failed service needs review; do not treat a new run as a continuation of a six-hour observation window. Use a separate run directory and update the service before starting a new observation window. The unit source is in `config/chog-noir-reliability.service`.

## Release deployment

The API, daily builder and live feed run from
`/home/ubuntu/chog-noir-release/current`. Each release is a detached Git worktree
named for its commit, with shared `data`, `runs` and `.env` symlinks. Each release
keeps a private, fixed `release-archive.json` snapshot, so rebuilding the working
archive cannot change existing released cases. Editing the
main checkout does not change the running release's source.

After committing and synchronizing a tested commit, run
`bash scripts/deploy-release.sh <full-commit-sha>` under systemd as `ubuntu`,
with the main checkout as its working directory. It installs the frozen lockfile,
runs the release checks and browser flow, saves its log under
`runs/game-preview/release-<short-sha>.log`, builds a public-only static bundle,
and then switches the source and static symlinks. It restarts only the Chog Noir
API. Nginx TLS configuration is maintained separately and must pass `nginx -t`.
Keep the preceding source worktree and matching static release.

To roll back, atomically point `chog-noir-release/current` to the previous
worktree and `/var/www/chog-noir` to its corresponding static directory under
`/var/www/chog-noir-releases/`, then restart `chog-noir-api.service`.
Shared plans, transaction journals, player data and source history stay in place;
never restore older copies of those files as part of a source rollback. Check
HTTPS health and deep links after either operation.

## Runtime services

The API, live worker, daily publisher and cleanup units use the current release.
Installing a unit is separate from proving it is running: record the unit result,
HTTP health and actual observation interval after enabling it. The live worker's
forced startup-failure check uses process-local RPC overrides; it never changes
`.env`. Its expected nonzero exit and redacted error are not a live-service pass.

Daily publication waits for a confirmed open transaction. A source outage after
00:10 UTC may select a labelled degraded fallback, while unavailable receipt or
commitment confirmation still prevents publication. MAIN and COLD use distinct
source events and exclude the previous seven plans. The saved daily status is
`runs/daily/status.json`; publication and transaction journals remain private.

The vault master key is stored outside ciphertext at
`/home/ubuntu/chognoir-private/vault.key` (or CASE_VAULT_KEY_FILE). The migration
command is `corepack pnpm exec tsx scripts/migrate-vault.mts`. It preserves the
existing encryption key; it does not create a wallet signer. Retain this key with
its encrypted cases when backing up or restoring runtime state.

Cleanup removes rendered PNGs older than seven days and empty guest profiles
older than thirty days. It skips busy players and retains scored results and
pending daily submissions. Run it manually with
`corepack pnpm exec tsx scripts/cleanup-game.mts` before installing the cleanup
timer. It does not purge casebooks or session files on an age threshold.

Automatic gas-price replacement remains disabled until the funded Monad probe is
verified. Each replacement preserves intent and nonce, retains every signed hash
and stays within the configured cost cap. A recovered opening must match a
finalized CaseOpened event and the saved deployment contract.
