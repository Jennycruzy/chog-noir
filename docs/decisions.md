# Build decisions

## 14 October 2026

- Start from public sources because the expected private data folder was not present. Save each download so the checks can be repeated.
- Keep the README clear that the game has no playable release yet. Add testing instructions for players when the game can be played.
- Use Node's built-in test runner for the first transaction integrity checks. Add TypeScript and Vitest with the core game code.
- Keep current OpenSea counts unconfirmed after the stats endpoint requested a key. Confirm them with authenticated access before comparing history totals.

## 16 October 2026

- Use strict TypeScript for the data scripts and Vitest for offline tests. This replaces the initial JavaScript scripts and Node test runner.
- Save original artwork locally. When a gateway fails or limits requests, try the next gateway and respect its wait time. OpenSea’s IPFS gateway also serves the original files.
- Choose accent colours by viewing original art because corners can contain hats, faces and accessories. Store the source image for every choice. Keep separate, explicit choices for the ten Chogs with no Background trait.
- Preserve metadata names exactly, including named suffixes. Record absent traits so later code can handle them explicitly.
- Compare individual chain transaction/token pairs with the complete OpenSea event feed. Record the separate aggregate stats discrepancy; do not treat its original count requirement as passed.
- Keep disputed routes out of cases. The data report records payment evidence without declaring a finished sale classifier.
