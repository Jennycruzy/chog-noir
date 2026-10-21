# Source-backed cases

Run `corepack pnpm cases:build` on the VPS. The builder reads saved classification,
enrichment, block timestamps and original metadata. Missing data fails the build.
It excludes unsupported or unclassified events from answers.

Sale prices come from payment records, including marketplace fees. Bundles and
unsupported payment routes are excluded. A quick resale requires a preceding
verified purchase. Cast ownership is evaluated at the event's block and log index;
later transfers do not contribute historical facts.

The private archive is stored at `runs/case-engine/archive.json`, alongside a
fallback pool. These files contain answer keys and random salts and must never be
served directly. Gameplay responses control access to sealed facts and keep
private answers server-side. Human-readable output and machine reports are
written outside the repository to private storage.

`corepack pnpm cases:build --verify-replay` rebuilds from the same source inputs and
requires byte-identical archive content, including keys and salts. The archive is
replaced atomically after validation. Existing cases retain their salts.

Run focused checks with
`corepack pnpm exec vitest run packages/cases/test --maxWorkers=1 --no-file-parallelism`.

## Receipt puzzles

`buildSalePuzzle` builds a receipt puzzle from a classified sale, its stored history,
block times and collection metadata. `config/cases.json` sets the weekly witness,
liar and sealed-receipt counts. Weekdays use one witness for both lies; weekends
use two witnesses for three lies. Alternate plans move all of a detective Chog's
lies to a truthful witness while preserving the receipt facts and solution tiles.

Keep the complete puzzle on the server. Its key commits the receipt ids, all plans,
solution, salt and file hash. `validatePuzzle` checks its structure and commitment;
`verifySalePuzzleSources` rebuilds the facts from the source records. A fresh hash
alone cannot make an edited receipt pass that source check. `provePuzzleSolvable`
then plays every detective skill and cast member at four questions, requiring a
solution with at least one question left. Run all three checks before publication.

The action engine handles Press, Present, opening receipts, skills and two solution
attempts. `viewPuzzleSession` exposes visible statements and receipts, conceals
follow-ups and sealed contents, and keeps the key and solution server-side during
play. Postgame false statements are returned only together with the exact label
“CAUGHT — false statement” and the receipt that breaks them. A result from the
engine is not proof that a career or an on-chain record has been written.

The Rookie desk uses the same action engine inside its temporary store. It has no
holder Side or friendship bonuses and labels the result `ROOKIE DESK`.
