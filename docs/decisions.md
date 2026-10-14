# Build decisions

## 14 October 2026

- Start from public sources because the expected private data folder was not present. Save each download so the checks can be repeated.
- Keep the README clear that the game has no playable release yet. Add testing instructions for players when the game can be played.
- Use Node's built-in test runner for the first transaction integrity checks. Add TypeScript and Vitest with the core game code.
- Keep current OpenSea counts unconfirmed after the stats endpoint requested a key. Confirm them with authenticated access before comparing history totals.
