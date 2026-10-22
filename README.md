Every night something real happens to Chogs on Monad. Every morning your Chog takes the case. One witness is lying. The chain never does.

[Play Chog Noir](https://chognoir.54-154-121-30.sslip.io/)

Chog Noir is a daily detective game played with a Chog Genesis NFT. Each case is a real
Chog sale from the night before. Three witnesses, real Chogs from that sale, tell you
what happened. One of them is lying about its own life on chain. You catch the lie by
presenting the real transaction receipt that breaks it, then say what really happened.

## Try it in three minutes

1. Open the site and tap **Play as a rookie**. No wallet, no sign-up: you get a real Chog
   as a bureau badge for today and play today's real case. Nothing you do there is kept.
2. Or **Connect wallet** with the wallet that holds your Chog (one signature, no gas).
   Your Chog becomes the detective.
3. Read the statements. **Press** a witness for its follow-up. **Present** the receipt that
   contradicts a statement: CAUGHT. Each catch unlocks the next truth.
4. **Solve** the sentence with the phrase tiles. You get partial feedback and a second try.
5. See what really happened, with a link for every number, and share a spoiler-free grid.

Answers are locked in the CaseBook contract on Monad mainnet,
[`0xf433f63d50ebc5ccb956f6ac915381f0bb0331ef`](https://monadscan.com/address/0xf433f63d50ebc5ccb956f6ac915381f0bb0331ef) (source verified).

Every closed case is a numbered issue at `/issues`. Every Chog's detective record is at
`/chog/<token id>`. Today's detectives are on the Precinct board at `/precinct`. Any case's
on-chain lock can be checked at `/verify`.

## Why the Chog is the game

- Only a Chog in your wallet can be your detective. Without one you can work today's case
  at the Rookie desk, but nothing is kept.
- Its traits are its skill: laser eyes open a sealed receipt, glasses highlight the
  receipts that matter, shifty eyes point out the liar, other eyes add questions, and the
  ten one-of-ones do two of those at once.
- The time you have held it sets your questions. Founders, Chogs that never left their
  minter, get one more.
- Witnesses that share a rare look, a past wallet or a mint slot with your Chog know it,
  and talk to it for free.
- The record is written to the token: solves, rank, streak, and the rogues' gallery of
  every Chog it caught lying. Sell the Chog and its career goes with it.
- The cases are the Chogs' own lives. Without the NFTs there is no case at all.

## What's real

| Part | What it is | Rule |
| --- | --- | --- |
| Cases | Real Chog sales on Monad mainnet, read from the chain | Nothing invented; a quiet day uses an older real sale |
| Statements | Witness lines in character | Lies exist only inside statements during play, planned by code |
| Receipts | One true fact from a real transaction each, with an explorer link | Never edited |
| Answers | Locked on chain before the case opens, revealed after it closes | Anyone can verify |
| Rookie desk | Today's real case with a borrowed bureau badge | Nothing is kept |
| Training case | A real archived case reduced to one lie | Marked REPLAY; counts for nothing |

After play, a false statement appears only on the same panel as the label
“CAUGHT — false statement” and the real receipt that breaks it. True stories, share
grids and records contain facts only.

## How it is built

- `packages/core`, `packages/indexer`: transfer history from HyperSync with an RPC cross-check,
  sale classification from Seaport `OrderFulfilled` payments, and the live owner index.
- `packages/cases`, `packages/witness`, `packages/solver`: the case builder. It picks the
  event, the witnesses, the receipts, the lies and the solution, and refuses any case a
  scripted perfect player cannot solve with every skill at four questions.
- `packages/game`, `packages/career`, `packages/auth`: the server-side case engine, the Rookie
  desk, wallet sign-in and the per-token career.
- `packages/chain`, `packages/publishing`, `contracts/`: the CaseBook contract that locks each
  answer before the case opens, reveals it at close, and records the cast and every
  detective's result.
- `workers/daily`: builds, checks, locks and publishes the case every night.
- `apps/api`, `apps/web`: the game API and site.

How a case is built: [docs/cases/README.md](docs/cases/README.md). How to check a case
yourself: [docs/verification.md](docs/verification.md). Running the service:
[docs/runbook.md](docs/runbook.md) and [docs/vps.md](docs/vps.md).

## Run it

Node 22.23 or 24.22 and `corepack pnpm install --frozen-lockfile`, then
`corepack pnpm typecheck`, `corepack pnpm test` and, in `contracts/`, `forge test`.
`corepack pnpm game:browser` plays the site end to end in headless Chromium.

Chog Genesis by CHOGLABS. Unofficial Chogathon entry.
