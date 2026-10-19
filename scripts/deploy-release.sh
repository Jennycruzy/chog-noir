#!/usr/bin/env bash
set -euo pipefail
repository=/home/ubuntu/chog-noir-monitor
releases=/home/ubuntu/chog-noir-release
sha="${1:?Pass a tested commit SHA}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full commit SHA is required'; exit 1; }
cd "$repository"
git cat-file -e "$sha^{commit}"
short="${sha:0:12}"
release="$releases/$short"
mkdir -p "$releases" runs/game-preview
exec 9>runs/game-preview/deploy.lock
flock -n 9 || { echo 'Another release deployment is running'; exit 1; }
if [[ ! -d "$release" ]]; then git worktree add --detach "$release" "$sha"; fi
[[ "$(git -C "$release" rev-parse HEAD)" == "$sha" ]]
for shared in data runs .env; do
 if [[ ! -e "$release/$shared" && ! -L "$release/$shared" ]]; then ln -s "$repository/$shared" "$release/$shared"; fi
done
cd "$release"
if [[ ! -f release-archive.json ]]; then install -m 600 "$repository/runs/case-engine/archive.json" release-archive.json; fi
corepack pnpm install --frozen-lockfile
bash scripts/check-release.sh > "runs/game-preview/release-$short.log" 2>&1
static="/var/www/chog-noir-releases/$short"
sudo mkdir -p /var/www/chog-noir-releases
if [[ ! -d "$static" ]]; then sudo cp -a runs/game-preview/web "$static"; fi
sudo chmod -R a+rX "$static"
previous="$(readlink "$releases/current" || true)"
ln -sfnT "$release" "$releases/next"
mv -Tf "$releases/next" "$releases/current"
if [[ -d /var/www/chog-noir && ! -L /var/www/chog-noir ]]; then sudo mv /var/www/chog-noir "/var/www/chog-noir-before-release-$short"; fi
sudo ln -sfnT "$static" /var/www/chog-noir-next
sudo mv -Tf /var/www/chog-noir-next /var/www/chog-noir
sudo cp config/chog-noir-api.service /etc/systemd/system/chog-noir-api.service
sudo systemctl daemon-reload
sudo systemctl restart chog-noir-api.service
printf '%s\n' "Release $sha activated; previous release: $previous"
systemctl show chog-noir-api.service -p WorkingDirectory -p ActiveState
