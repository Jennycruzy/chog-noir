#!/usr/bin/env bash
# Nightly copy of the private runtime state that cannot be rebuilt from the chain, kept for fourteen nights.
set -euo pipefail
umask 077
repository=/home/ubuntu/chog-noir-monitor
private=/home/ubuntu/chognoir-private
target="${CHOG_BACKUP_DIR:-/home/ubuntu/chog-noir-backups}"
mkdir -p "$target"; chmod 700 "$target"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
paths=()
for path in runs/puzzle-publications runs/publication-vault runs/career runs/play runs/chain runs/daily/cases runs/daily/status.json runs/owners/snapshot.json runs/owners/base.json runs/push runs/optout runs/burns runs/arc .env; do
 [[ -e "$repository/$path" ]] && paths+=("repository/$path")
done
extra=()
for path in "$private"/vault.key "$private"/push-vapid.json "$private"/signer-*.key; do [[ -e "$path" ]] && extra+=("private/$(basename "$path")"); done
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
ln -s "$repository" "$work/repository"; ln -s "$private" "$work/private"
tar -C "$work" --dereference -czf "$target/runtime-$stamp.tar.gz.part" "${paths[@]}" "${extra[@]}"
mv "$target/runtime-$stamp.tar.gz.part" "$target/runtime-$stamp.tar.gz"
ls -1t "$target"/runtime-*.tar.gz | tail -n +15 | xargs -r rm -f
echo "{\"backup\":\"$target/runtime-$stamp.tar.gz\",\"bytes\":$(stat -c %s "$target/runtime-$stamp.tar.gz")}"
