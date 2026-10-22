# Source-backed cases

Every case starts from one real paid move: a marketplace sale priced by its `OrderFulfilled`
payment, or an escrow deal paid in $CHOG and proven by the token's own Transfer log. Bundles,
unsupported routes and unclassified events are never used. Ownership is evaluated at the
case's evidence cutoff; later transfers never contribute facts.

The daily builder (`workers/daily/build.mts`) ranks yesterday's real moves by case type and
score: a Founder's first move since mint, a quick resale, a big spender, a long hold ending,
a Chog that keeps moving, or a $CHOG deal. It tries them in order and keeps the first that
passes every check below. A quiet day takes a cold case from an older real sale that none of
the previous seven cases used, in an order fixed by the day. Events involving a wallet that
opted out are skipped.

Witnesses must have a recorded connection to the event: Chogs in the seller's or buyer's
wallet, earlier wallet-mates, or Chogs sold within six hours of it. Sales after the subject
may join only up to the opening time and never past the subject's own next move; the evidence
cutoff moves only as far as needed to fill the cast.

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

`ClaimCatalog` derives direct contradictions and inferences from continuous token
histories. It compares those histories with independently indexed transfers, so
an omitted round trip cannot reduce an owner count or manufacture a first move.
Payment claims require a positive, source-backed seller payout; $CHOG receipts
also check the official token, escrow sender, seller recipient and exact amount.
A shared signed bulk action proves that transfers travelled together, without
asserting common wallet ownership or a relationship between people.

`selectClaimPuzzle` composes eligible claims into four to six receipt cards and
runs the solver for every skill and own-Chog alternative. Related facts share a
card when separate cards would prove the same contradiction. Unsupported claims
remain unavailable. `verifyComposedPuzzleSources` reconstructs the selected facts,
receipts and plans from the saved sources and committed claim identifiers.
