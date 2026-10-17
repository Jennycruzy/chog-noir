# Chog Noir monitor host

Use the VPS previously selected for this project: `ubuntu@54.154.121.30`. The monitor runtime is isolated at `/home/ubuntu/chog-noir-monitor`. Keep long reliability runs on this VPS, not the local development computer.

The `chog-noir-reliability.service` systemd service runs as `ubuntu`, with its own working directory and a six-hour duration. It does not depend on an SSH session or the local computer staying on. The runtime receives only the HyperSync credential needed for history access, stored in a mode-600 `.env`; other project credentials are not deployed.

Check service state with `sudo systemctl status chog-noir-reliability.service` and logs with `sudo journalctl -u chog-noir-reliability.service`. Progress and reports are saved under `/home/ubuntu/chog-noir-monitor/runs/reliability-vps/` as `run-summary.json`, `snapshot.json`, source pages and the final `reliability-report.json`.

This is a single observation run. The service does not automatically restart failed runs or start at boot. A stopped or failed service needs review; do not treat a new run as a continuation of a six-hour observation window. Use a separate run directory and update the service before starting a new observation window. The unit source is in `config/chog-noir-reliability.service`.

The earlier local run at `runs/reliability/2026-10-16T19-49-04-806Z/` was deliberately stopped and is marked `INTERRUPTED`. It does not count toward the VPS observation window.
