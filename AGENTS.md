# Project execution

The full project runs on `ubuntu@54.154.121.30` in `/home/ubuntu/chog-noir-monitor`.
Use the VPS for builds, tests, data collection and other execution. Keep long jobs
under systemd with persistent logs and reports, so closing SSH or shutting down
the local computer does not stop them. Run package commands with `corepack pnpm`.

Keep Git work on `main` and commit substantial changes with plain descriptions of
what changed. Use product changes rather than internal progress labels in commit messages.
Synchronize source changes before executing them on the VPS. Preserve VPS-only
data and run evidence; do not use a destructive mirror or copy local dependencies
over Linux dependencies.

Environment configuration stays private in `.env`. Authoritative private build
instructions live outside the repository in `/home/ubuntu/chognoir-private/`
on the VPS and `/Users/user/chognoir-private/` locally. Read the authoritative
build instructions there before changing product behavior. Keep internal progress
notes and reports there too.

See [docs/vps.md](docs/vps.md) for service and runtime details.
