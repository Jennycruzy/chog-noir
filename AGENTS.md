# Project execution

The full project runs on `ubuntu@54.154.121.30` in `/home/ubuntu/chog-noir-monitor`.
Use the VPS for builds, tests, data collection and other execution. Keep long jobs
under systemd with persistent logs and reports, so closing SSH or shutting down
the local computer does not stop them. Run package commands with `corepack pnpm`.

Keep Git work on `main` and commit substantial changes with plain descriptions of
what changed. Do not use milestone, phase or gate labels in commit messages.
Synchronize source changes before executing them on the VPS. Preserve VPS-only
data and run evidence; do not use a destructive mirror or copy local dependencies
over Linux dependencies.

Environment configuration stays private in `.env`. The private build specification
is outside the repository at `/home/ubuntu/chognoir-private/BUILD-SPEC.md` on the VPS
and `/Users/user/chognoir-private/BUILD-SPEC.md` locally. Never commit either.

See [docs/vps.md](docs/vps.md) for service and runtime details.
