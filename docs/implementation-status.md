# Completion work in progress

The user requested finishing the implementation before returning to the Claude
API key and their evidence/tone audit. Those reviews remain deferred; do not ask
for them as a prerequisite for implementation or describe them as passed.

The public deployment at the start of this work is commit `3f221ad`: fourteen
archive cases and one Arrival card. It remains the last verified deployment.
Current uncommitted source is being extended and must be tested on the VPS before
deployment. The VPS has substantial shared CPU contention. Keep long checks and
jobs under systemd and preserve source data and evidence.

## Written, awaiting integrated verification

- Ten source-backed witness cards, event/log cutoffs, owner/sale/roommate memories,
  fixed unknown responses, banded/exact prices and template validation.
- Trait-derived powers, tier uses, side discount, Money Talk, special-card bonus,
  clean trait labels and all four Eyes groups.
- Guest progress, deterministic starter selection, collection unlocks, unique
  casebook results, UTC daily streaks, alibis and ranks.
- API/player/collection/profile/report/Scam Desk screens and data endpoints.
- CaseBook Solidity contract and twenty-five Foundry tests.
- Encrypted authenticated case vault, publication state machine, durable signed
  transaction journal and gas cap, deploy/status/source-verification commands.
- Daily finalized-history collection, source/receipt checks, fresh-case selection,
  cold fallback, main/cold plans, confirmed-open publication and scheduled close.
- Public commitment verifier and API publication loading.

## Still required before calling the work finished

- Finish and validate the live sale worker/feed and its operational service.
- Finish comic/share downloads and the remaining frontend wiring and clear status
  copy. Check real browser flows, keyboard, mobile and restored sessions.
- Run type checking and appropriate old/new regressions on the VPS. The 19 October VPS run passed TypeScript checking, JavaScript syntax checking and
  all 25 Foundry tests. The broader Vitest run was stopped before producing a
  result; focused regressions and the complete expanded run remain required.
- Test all real archive memories and powers, publishing retries, encryption,
  premature reveal protection, streaks, proof-only Scam Desk, and contract behavior.
- Run the daily builder without writes and verify its persisted output; install
  timers/services with honest health state. Never publish without a confirmed open.
- Commit/push substantial completed pieces on main, synchronize and deploy tested
  source, verify public HTTPS and preserve rollback artifacts.

## External activation prerequisites

On the VPS, `SERVER_PRIVATE_KEY`, `CASEBOOK_ADDRESS`,
`EXECUTION_WRITES_ENABLED` and `DATABASE_URL` were not configured. HyperSync is
configured and Foundry binaries exist under `/home/ubuntu/.foundry/bin/`.
No private signing key has been generated or requested in chat. No mainnet write
has occurred. Mainnet deployment/activation needs a locally configured, funded
server signer and the explicit write switch. Finish the implementation first;
report that activation boundary concretely, without confusing it with Claude or
the deferred human audit. A seven-day operational record cannot be claimed from
offline tests or a short smoke run.


## Current correctness work

Daily submissions now keep scores, answer keys, proof records and unopened sealed
facts private until a confirmed close. Player results remain pending; MAIN streak
credit is recorded at submission, while scores and unlocks wait for reveal. Comic
and share endpoints reject locked cases, and existing open daily sessions cannot
be restarted. The HTTP regression passed on 19 October, including pending results, locked downloads, restart refusal and one-time finalization after close. This is not a deployment claim.

The archive builder now uses full source memories and varied lies, assigns new
case identifiers ending in `-v2`, and checks the false line against its selected
contradiction. All 14 rebuilt real cases passed the smoke test on 19 October. The archive has three lie cards, with the subject as liar in 7 of 14 cases.
Release worktree scripts are prepared but have not been activated.


The focused run covered 89 tests: 88 passed initially, then the archive-identifier
validation fix passed a seven-test API rerun. The 25 contract tests and three
local-chain transaction-journal tests passed. The final real-data check validated
880 card variants, all 1,969 partners, and 410 proof-backed forged records. Comic
rendering passed at 1080×1350; the share card passed at 1200×630 and 226,111 bytes.
The private-file scan passed for 223 repository files. Full-suite and release
browser checks remain required before deployment. Reports are in
`docs/audit/evidence/full-game.json`, `game-preview.json`, and `case-archive.json`.
