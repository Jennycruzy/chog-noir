#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p runs/chain
export CHOG_CHAIN_LOCKED=true
exec flock -n runs/chain/write.lock node --import tsx scripts/chain.mts deploy
