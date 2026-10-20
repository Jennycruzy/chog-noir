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
