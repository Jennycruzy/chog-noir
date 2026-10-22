# Chog Noir

**A daily detective game where Chog NFTs are the witnesses, and the blockchain is the lie detector.**

Every night something real happens to Chogs on Monad: a sale, a trade, a first move after
mint. Every morning that event becomes a case. Three Chogs involved in it tell you what
happened, and one of them is lying about its own history. You catch the lie by presenting the
real transaction that proves it wrong.

## Try it

| | |
| --- | --- |
| **Play today's case** (no wallet, about 3 minutes) | [chognoir.54-154-121-30.sslip.io](https://chognoir.54-154-121-30.sslip.io/) → **Play as a rookie** |
| **See how answers are locked before anyone plays** | [Verify case #1](https://chognoir.54-154-121-30.sslip.io/verify/case-56bb0a9ab0a2e08b8cb47ce9) |
| **The contract that holds every answer** | [CaseBook on Monadscan](https://monadscan.com/address/0xf433f63d50ebc5ccb956f6ac915381f0bb0331ef) (source verified) |
| **Case #1 sealed on chain** | [Transaction](https://monadscan.com/tx/0xf1e38433e5fd061d09bd3a62ee21bec8b089a055eed971c561bc3db6af090969) |
| **Today's detectives** | [Precinct board](https://chognoir.54-154-121-30.sslip.io/precinct) |
| **A Chog's detective record** | [CHOG #1025](https://chognoir.54-154-121-30.sslip.io/chog/1533) |
| **What is real, and the sources** | [What's real](https://chognoir.54-154-121-30.sslip.io/about) |

Chog Noir runs on Monad mainnet with real Chog Genesis NFTs. Nothing in a case is invented.

## How a case plays

1. **Read the witnesses.** Each Chog in the case gives a statement about what happened. You can
   press a witness to make it say more; that costs one of your questions.
2. **Present the receipt.** Every receipt is one true fact from a real transaction, with a link
   to the explorer. Hold the right receipt against the false statement and the witness is
   **CAUGHT**. Each catch reveals the next true fact, and the lying Chog changes its story.
3. **Say what happened.** Fill in a short sentence with phrase tiles. You get feedback and a
   second try.
4. **See the reveal.** Every lie is shown next to the receipt that broke it, followed by the true
   story. You get a grade and a spoiler-free result grid to share.

Weekdays have one lying Chog. Weekends have two. Cases get harder through the week.

## Why the Chog matters

The NFTs are not decoration. Without them there is no game.

- **The cases are the Chogs' own lives.** Every case is a real event in a Chog's history on Monad,
  and the witnesses are the Chogs connected to it.
- **Your Chog is your detective.** Connect the wallet that holds it (one signature, no gas fee). Its
  traits decide its skill: laser eyes open a sealed receipt, glasses highlight the receipts that
  matter, shifty eyes point to the liar, and other eyes earn extra questions. The ten one-of-one
  Chogs combine two skills.
- **How long you have held it sets your questions.** A Chog that has never left the wallet it was
  minted to is a Founder and gets one more.
- **Witnesses may recognise your Chog.** If a witness shares a rare look, a past wallet or a nearby
  mint number with your Chog, it talks to you for free.
- **The record belongs to the token.** Cases solved, rank, streak and every liar your Chog has
  caught stay with that Chog. Sell it and its career goes with it. After each case closes, every
  holder's result is written to the CaseBook contract.

No Chog? The **Rookie desk** lets anyone play today's real case with a borrowed Chog badge.
Nothing played there is kept.

## $CHOG

- **It is evidence.** "Follow the $CHOG" cases come from real deals paid in $CHOG.
- **It buys a question.** A holder can burn 100 $CHOG to bribe the informant for one extra question,
  up to twice per case. The burn is checked on chain before it counts, and it never adds points.
- **It earns a stamp.** Wallets that hold $CHOG get a $CHOG stamp on their detective's record.

Nothing is paid out to anyone.

## How you can check it

Before a case opens, a fingerprint of its answer (a hash) is written to the CaseBook contract.
Once the case closes, the full answer is published on chain, and the contract rejects any
answer that does not match the fingerprint. So the answer cannot be changed after anyone
has played.

To check any case, open `/verify/<case id>` on the site, or run:

```
corepack pnpm verify case-56bb0a9ab0a2e08b8cb47ce9
```

While a case is open, it reports `COMMITMENT_VERIFIED`. After it closes, it reports `PASS`.
Details are in [docs/verification.md](docs/verification.md).

Each receipt in a case names its transaction, block and log entry, and links to Monadscan.

## The daily rhythm

- **00:20 UTC:** yesterday's case closes and its answer is revealed on chain. Today's case is
  built from last night's real events, sealed on chain, and opened.
- **During the day:** players work the case. The front page shows Chog sales as they happen, and
  a "story" follows any Chog that keeps moving, with a free daily hunch about its next move.
- **After each close:** the case becomes a numbered issue, a comic page made from the real Chog
  art, at [/issues](https://chognoir.54-154-121-30.sslip.io/issues).

Players can opt in to browser alerts when a new case opens, or when their own Chog is in one.

## What it is built from

- 5,130 Chog Genesis transfers across all 1,969 tokens and 2,302 wallets, read from Monad mainnet
  and kept up to date as new blocks arrive.
- Sale prices read from the marketplace's own payment records (Seaport `OrderFulfilled` events).
- Chog art and traits from the collection's own metadata on IPFS, as published by the Chog
  Genesis contract `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`.

## How it is built

| Part | Where | What it does |
| --- | --- | --- |
| Chain reader | `packages/core`, `packages/indexer` | Reads every Chog transfer and sale, and keeps the list of current owners up to date |
| Case builder | `packages/cases`, `packages/witness`, `packages/solver` | Picks the event, witnesses, receipts and lies; refuses any case a perfect player could not solve with every detective skill |
| Game | `packages/game`, `packages/career`, `packages/auth` | Runs each case on the server, the Rookie desk, wallet sign-in and each Chog's career |
| On chain | `contracts/`, `packages/chain`, `packages/publishing` | The CaseBook contract that seals answers, reveals them and records results |
| Daily job | `workers/daily` | Builds, checks, seals and publishes the case every night |
| Site | `apps/api`, `apps/web` | The game server and the website (plain HTML, CSS and JavaScript) |

The server decides every catch, score and answer. The browser only shows the case and sends
the player's moves, so the answer never reaches the browser while a case is open.

More detail:
[how a case is made](docs/cases/README.md) ·
[checking a case](docs/verification.md) ·
[running the service](docs/runbook.md) ·
[server setup](docs/vps.md)

## Run it yourself

You need Node 22.23 (or 24.22) and Foundry.

```
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
cd contracts && forge test
```

`corepack pnpm game:browser` plays the whole site in a headless browser (phone touch,
keyboard only, and holder paths).

## Current state

- Live on Monad mainnet since 22 October 2026. Case #1 opened that day.
- Holders can play only with a Chog in the wallet they sign in with. Delegated wallets are not
  supported yet.

Chog Genesis by CHOGLABS. Unofficial Chogathon entry.
