# Chog Noir VPS

Use `ubuntu@54.154.121.30` as the project's execution host. The full checkout lives at `/home/ubuntu/chog-noir-monitor`; the existing directory name is retained so deployed services and saved report paths remain valid. It includes Git history, application and package source, contracts, scripts, configuration, mirrored artwork and metadata, source data, and saved runs. Keep long work on this VPS, independent of the local computer.

Dependencies are installed for Linux from `pnpm-lock.yaml` using `corepack pnpm install --frozen-lockfile`. Run project commands from the checkout using `corepack pnpm`. The private build specification lives separately at `/home/ubuntu/chognoir-private`, outside Git. Project credentials are stored in a mode-600 `.env`; they are never committed. The migration preserves existing VPS settings and backs up its previous environment file privately.

The `chog-noir-api.service` systemd service serves the archive game API and starts at boot. Nginx serves the public preview at https://chognoir.54-154-121-30.sslip.io/ and proxies `/api/` and `/health`. The local computer and SSH session can be turned off without stopping these services. This is archive play, not a live daily case or continuous indexer.

The API loads the validated private archive at startup, then stores guest sessions
in ignored `runs/game-sessions/`. `corepack pnpm game:web` assembles HTML, JavaScript,
CSS and only the required original portraits under `runs/game-preview/web/`.
Nginx serves a copy of that public-only bundle from `/var/www/chog-noir`; it has no
route to the source archive, metadata, environment or session files. Preserve the
host's existing Certbot TLS directives when updating Nginx. See
[preview operation and verification](game-preview.md).

Use systemd for long jobs, with an explicit working directory and a persistent output directory under `runs/`. A plain foreground SSH command can stop when its connection closes. The `chog-noir-reliability.service` runs as `ubuntu`, with its own working directory and a six-hour duration, independently of SSH.

Check service state with `sudo systemctl status chog-noir-reliability.service` and logs with `sudo journalctl -u chog-noir-reliability.service`. Progress and reports are saved under `/home/ubuntu/chog-noir-monitor/runs/reliability-vps/` as `run-summary.json`, `snapshot.json`, source pages and the final `reliability-report.json`.

This is a single observation run. The service does not automatically restart failed runs or start at boot. A stopped or failed service needs review; do not treat a new run as a continuation of a six-hour observation window. Use a separate run directory and update the service before starting a new observation window. The unit source is in `config/chog-noir-reliability.service`.

The earlier local run at `runs/reliability/2026-10-16T19-49-04-806Z/` was deliberately stopped and is marked `INTERRUPTED`. It does not count toward the VPS observation window.
