# How a case is made

Every case starts from one real event in a Chog's life on Monad, and every fact in it can be
traced back to a transaction.

## 1. Pick the event

Each night the daily job looks at the previous day's real Chog moves that were paid for:

- **Marketplace sales**, priced from the marketplace's own payment record.
- **$CHOG deals**, where a Chog changed hands in exchange for $CHOG through escrow.

Bundled sales, unrecognised routes and anything that cannot be priced are never used.

The moves are ranked by how good a story they make: a Chog's first move since mint, a quick
resale, a big purchase, a long hold coming to an end, a Chog that keeps moving, or a $CHOG deal.
The builder tries them in that order and keeps the first one that passes every check below.

On a quiet day it uses an older real sale that none of the last seven cases used. Wallets
whose owners opted out are never used.

## 2. Call the witnesses

The witnesses are real Chogs with a recorded connection to the event: Chogs in the seller's or
buyer's wallet, Chogs that once shared a wallet with them, or Chogs sold within six hours of it.

Each case has a cutoff time. Only what had happened by then counts as evidence, so nothing
that happened afterwards can leak into the case.

## 3. Write the statements and the lies

Each witness gives statements about the event, in its own voice. A lie is a statement that one
real receipt contradicts. Everything else a witness says is true.

- Weekdays: one witness lies.
- Weekends: two witnesses lie.

If your own Chog would be a liar in the case, its lies move to another witness, so a detective
never has to accuse itself.

## 4. Attach the receipts

Each receipt is one true fact from one transaction: when a Chog arrived in a wallet, what was
paid, which other Chogs were in that wallet at the cutoff. Every receipt links to Monadscan.
Some receipts start sealed and cost questions to open.

## 5. Prove it can be solved

Before a case is published, a scripted perfect player works through it once for every detective
skill, with only four questions. If any of them cannot solve it with at least one question to
spare, the case is thrown out and the next event is tried.

The facts are also rebuilt from the saved chain records. A case whose facts do not match its
sources is never published.

## 6. Seal it on chain

The answer (which witnesses lie, which receipt breaks each lie, and the solution) is kept
private on the server. Only its fingerprint goes on chain, in the CaseBook contract, before the
case opens. The full answer is revealed on chain when the case closes. See
[checking a case](../verification.md).

## During play

The server runs the case. The browser receives a witness's follow-up only after the player
presses for it, and a sealed receipt only after the player opens it. The answer is never sent
to the browser while the case is open.

After play, a false statement is only ever shown next to the label
"CAUGHT — false statement" and the receipt that broke it. True stories, share grids and records
contain facts only.

## For developers

- Event choice and the quiet-day fallback: `workers/daily/build.mts`
- Puzzle building, validation and source checks: `packages/cases/src/puzzle.mts`
- The perfect-player check: `packages/solver/src/solve.mts`
- Weekly witness, liar and sealed-receipt counts: `config/cases.json`

Run the case tests with
`corepack pnpm exec vitest run packages/cases/test --maxWorkers=1 --no-file-parallelism`.
