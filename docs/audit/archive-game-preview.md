# Archive game review — 18 October 2026

Status: first playable archive flow. This does not complete or approve M0–M4.

The fourteen validated historical drafts can be played through partner selection,
Arrival-card questioning, sealed ledger access, evidence-backed accusations,
three questions and a scored reveal. Original Chog art is used throughout.
Guests can resume the current session and keep a browser casebook. The UI labels
the archive, template dialogue and absent on-chain publication explicitly.

## Evidence

- Type checking and browser-JavaScript syntax checking pass on the VPS.
- All 25 focused tests pass: twelve existing case-builder/selector regressions,
  eight game-rule tests and five HTTP API tests. They cover hidden answers,
  card costs, each starter power, proof-backed accusations, invalid actions,
  concurrent requests, restart recovery and locked final submission.
- [Real-archive HTTP report](evidence/game-preview.json): all fourteen actual
  cases pass; all three partner powers are exercised; every revealed commitment
  matches the saved archive.
- [Chromium report](evidence/game-preview-browser.json): desktop and 360px mobile
  flow passes, including original artwork, partner pick, witness question, unseal,
  accusation, refresh, questions, reveal, casebook and navigation. No JavaScript
  exceptions or horizontal overflow were observed. Screenshots and persistent
  verification logs remain under `runs/game-preview/` on the VPS.
- The private-file scan passes. The assembled web bundle contains three frontend
  files and 45 original portraits; no private archive or session files are copied.
- [Public HTTPS verification](evidence/game-preview-hosting.json) passes for the
  deployed preview: fourteen-case catalogue, frontend assets, original art,
  Secure/HttpOnly/SameSite session cookie, saved questioning action and resume.
  Environment, archive, session and raw metadata paths return 404. The previous
  readiness page and host/service configuration are preserved on the VPS for
  rollback. The deployment job ended successfully.

## Remaining work

The other nine evidence cards, full fact sheets, final trait map, all partner
rules, additional case families, comics, daily streaks, collection, live model
evaluation, human tone/case review, on-chain publication and the broader product
remain unfinished. A browser check is not human approval or a hallway-test pass.
Existing full-suite database timeout concerns are not resolved by these checks.
The server remains shared and showed substantial CPU contention during this work.

Session files support one API process; expiry, cleanup, account migration and
production load testing remain hardening work. See [implementation and operating
limits](../game-preview.md).
