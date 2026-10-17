# Source-backed archive cases

Run `corepack pnpm cases:build` on the VPS. The builder uses the saved complete
classification/enrichment history, block timestamps and original metadata. It
selects one sale for each of the fourteen complete UTC days preceding the
snapshot's last partial day. Missing data fails the build instead of inventing a
case. No API key or model generation is needed.

The first supported families are Quick Exit, Big Spender, Long Goodbye and a
general archived sale. Exact payment and sale-route evidence are required.
Bundles, unclassified movements, escrow collections and transfers back to the
same owner are excluded. A short resale requires a preceding verified purchase;
a short hold after mint or an ordinary transfer does not suffice. Discount and
premium thresholds compare integer base units against the median of seven prior
supported sales. The reference is explicitly not a historical OpenSea floor.

Selection uses rarity, price gap, holding time, cast diversity, freshness and the
seven-case repeat penalty. Casts use ownership at the sale's exact log cutoff,
then recent earlier sales or a labelled neighbour. Eyes groups currently follow
the provisional power mapping; this does not freeze the final trait map or imply
human approval of trait labels. No later event contributes a witness or a wrong
answer option. A tied score prefers the later block and log.

Each draft has three questions with four distinct options, a source-linked ledger,
two to six witnesses, and one false arrival date. Witness templates pass the
existing fact/voice validator. The correct arrival remains in the ledger and a
single ledger line disproves the lie. Two ledger lines start sealed. Question
answers must match typed ledger values. Source verification rebuilds the entire
draft from the original classified records and metadata, detecting edited text,
options, testimony or keys.

`runs/case-engine/archive.json` holds draft content, private answer keys and random
32-byte salts. Keep it private. Rebuilding an existing case reuses its salt and
preserves deterministic content. Its answer commitment is keccak256 of canonical
JSON `{v:1,caseId,key,salt}`; this binds the key to one case. No commitment is
submitted to a chain by this command. This format must be shared with the future
contract verifier before publication.

Use `corepack pnpm cases:build --verify-replay` to rebuild against the same saved
inputs and require a byte-for-byte match of the complete archive, including its
keys and salts. The archive is replaced atomically only after validation passes.

The generated [readable review](archive-review.md) deliberately contains answer
spoilers and is for review. Draft data includes complete ledger facts, including
sealed facts; it must not be served directly as a gameplay API. A future gameplay
API must control ledger access and keep keys and salts server-side. Nothing here
publishes a daily game or counts as human tone or gameplay approval.

Other case families, full ten-card fact sheets, interactive play, scoring, partner
powers and on-chain publication remain to be implemented. The API currently
serves its existing health check. Run focused verification on the shared VPS with
`corepack pnpm exec vitest run packages/cases/test --maxWorkers=1 --no-file-parallelism`.

The [saved archive report](../audit/evidence/case-archive.json) covers 30 September
through 13 October 2026: fourteen drafts, forty-two questions and fourteen planned
lies. The selected mix is six Big Spenders, four Quick Exits and four general
archive cases. No source hold qualifies for the ninety-day Long Goodbye rule.
All drafts pass source rebuilding and byte-identical replay. Twelve focused
case-engine tests, type checking and the private-file scan pass on the VPS.
Earlier full-suite database tests still time out on this shared host; this case
work does not claim to resolve those failures or establish a full-suite pass.
