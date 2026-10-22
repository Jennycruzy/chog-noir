#!/usr/bin/env bash
set -euo pipefail
mkdir -p runs/game-preview
corepack pnpm exec tsc --noEmit
node --check apps/web/app.js
(cd contracts && /home/ubuntu/.foundry/bin/forge build && /home/ubuntu/.foundry/bin/forge test)
CHOG_DATABASE_TEST_TIMEOUT_MS=600000 corepack pnpm exec vitest run --maxWorkers=1 --no-file-parallelism --testTimeout=60000 --hookTimeout=120000
corepack pnpm game:smoke
corepack pnpm check:private
corepack pnpm game:browser
CHOG_BROWSER_KEYBOARD_ONLY=true corepack pnpm game:browser
corepack pnpm game:web
