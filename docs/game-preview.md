# Playable archive preview

The first playable flow uses the fourteen saved case drafts, original Chog art,
and validated template testimony. It is an archive preview, not the daily game.
No model call, wallet, sign-in, payment or chain write is involved in playing.

Choose a file, choose one of three source-backed starters, question witnesses
with the Arrival card, examine the ledger, catch the false alibi with an opened
contradicting record, and answer three questions. The reveal includes the correct
facts, transaction links, score, grade and a copyable result. A guided first case
can be skipped. The case drawer, how-to, casebook and sources explanation are
available from the navigation.

## Server boundary

`apps/api/src/game.mts` reads the private archive once at startup. Explicit response
projections omit keys, salts, raw ownership timestamps, answer-value fields,
question-to-ledger mappings and unopened sealed fact contents. Testimony is
returned only after its card is played. Keys and salts are revealed only after a
valid final submission; the revealed commitment can be downloaded and reproduced
with `answerHash` in `packages/cases/src/build.mts`. It is not an on-chain proof.
The repository's review document intentionally contains spoilers.

An HttpOnly, Secure, SameSite cookie identifies the active guest session. Session
files live outside the web root in ignored `runs/game-sessions/`, with private
permissions and atomic replacements. Same-session writes are serialized; every
mutation requires the latest revision so retries and double clicks do not charge
twice. A submission locks the session. Only the server changes plays or scores.
Cross-origin writes and oversized requests are rejected. New session creation is
limited to twenty per IP per minute in the single API process.

Refreshing resumes the active file, including a closed file. Selecting a new
partner starts a new session; the UI warns before replacing an unfinished file.
Closed-file summaries live in browser local storage. Archive play earns no daily
streak, rank, partner unlock or public record. A browser with storage disabled can
still play; its casebook will not persist. Guest sessions are not accounts.

## Deliberate limits

- Only the Arrival card is connected; the full ten-card fact sheets remain open.
- Three fixed starters provide simplified X-ray, Analyst and Empath powers. The
  full tier, side, mouth and special-trait rules and collection are unfinished.
- Scores follow the specified answer, lie, card and perfect-answer formula.
  Empath's extra plays can produce a higher maximum than the base eight-play case.
- Dialogue uses templates. Live Claude evaluation and human tone review remain
  pending. The final trait map and case review are not declared approved.
- Daily publication, finality/reorg handling, comics, public stats, breaking cases,
  other case families and on-chain commitments remain separate work.
- Disk sessions support one API process. This is not a multi-worker session store.
  Session expiry/cleanup and production load testing remain hardening work.

## Execution and verification

Use the VPS as required by `AGENTS.md`. `corepack pnpm game:serve` listens on
loopback port 8311. Nginx serves `apps/web/` copied to `/var/www/chog-noir`, proxies
`/api/` and `/health`, and exposes only the required mirrored portraits under `/art/`.
Run `corepack pnpm game:web` to assemble a public-only bundle under
`runs/game-preview/web/`; copy that bundle into the web root. It contains no
metadata files, archive, session files, keys or salts.
Preserve the deployed hostname's Certbot TLS configuration when updating Nginx.

Run type checking, browser-JavaScript syntax checking, and focused regressions:

```sh
corepack pnpm typecheck
node --check apps/web/app.js
corepack pnpm exec vitest run packages/game/test apps/api/test packages/cases/test --maxWorkers=1 --no-file-parallelism --testTimeout=30000 --hookTimeout=30000
corepack pnpm game:smoke
corepack pnpm game:browser
corepack pnpm check:private
```

The real-archive smoke check uses an isolated temporary session directory and
the actual private archive. It plays all fourteen cases through HTTP, alternates
all three partner powers, checks initial answer privacy, catches each planned
lie, submits the three correct answers and reproduces the revealed hash. It
writes `docs/audit/evidence/game-preview.json` without keys or salts. Unit and HTTP
regressions separately cover stale/concurrent actions, overspending, false
accusations, invalid submissions, cross-origin requests and restart recovery.

The browser script uses the VPS's cached Chromium, an isolated session directory,
and the same content security policy as Nginx. It exercises the visible flow,
refresh recovery, casebook and navigation, checks for JavaScript errors and
horizontal overflow at 360px, and saves desktop/mobile screenshots under
`runs/game-preview/browser/`. Set `CHOG_BROWSER` to use another installed Chromium.
It does not download a browser or change production sessions.

These checks do not establish a human hallway-test pass, a full accessibility
audit, a full repository test pass or completed M0–M4 approval.
