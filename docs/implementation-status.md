# Implementation and activation status

Updated 19 October 2026. The last verified public application is commit
`3f221ad`: fourteen archive cases with the original Arrival-card game. The full
witness implementation below has not yet been deployed. HTTPS direct routes
were repaired independently; that does not constitute an application release.

## Implemented and checked on the VPS

The game has ten source-backed witness cards, cutoff-aware ownership and sale
memories, explicit unknown answers, banded/exact prices and varied planned lies.
All 1,969 partners have trait-derived powers, tier uses and passive benefits:
278 X-ray, 369 Analyst, 234 Takes One and 1,088 Empath. Money Talk applies to
236 partners; 100 have the special bonus. Sides are 1,309 Buyer and 660 Seller.
Guest progress includes deterministic starters, recruitment, a casebook, daily
streaks, alibis and ranks. The API serves collection/profile pages, reports and
the proof-backed Scam Desk.

Daily submissions retain pending results and MAIN streak credit while keeping
scores, keys, proof records and sealed facts private until a confirmed close.
Locked downloads and open-case restarts are refused. Practice replays cannot
improve a saved daily score or earn extra streak credit. Read-only new guests
receive a stable cookie without creating a player file. Cleanup shares player
locks and preserves results and pending submissions.

Publication records are loaded independently, with corruption reported in health
and valid cases retained. Saved source history refreshes within thirty seconds.
The vault master key migrates outside ciphertext storage without changing the
key; missing keys never silently replace keys for existing ciphertext.

Daily source recovery waits until 00:10 UTC before using a labelled degraded
fallback. A private pool of sixteen distinct events supports disjoint MAIN/COLD
slots without reusing the previous seven plans. Ranking applies recent published
subject and wallet penalties. Selected ledger and witness sources are checked
against successful canonical transaction receipts.

The chain writer persists signed bytes before broadcast, retains all replacement
hashes, preserves nonce and intent, and caps a 25% gas-price increase after ten
minutes. Automatic replacement remains disabled until a funded Monad probe is
verified. A matching finalized CaseOpened event recovers a lost opening receipt
without another signature. Conflicting commitments stop recovery.

Evidence collected on the VPS:

- All 25 Foundry contract tests passed.
- The focused recovery suite passed all 63 tests across thirteen files, including
  five isolated local-chain transaction/recovery tests. Short test epochs reduce
  waiting; production finality checks are unchanged.
- All 22 database assertions passed with a bounded shared-host startup allowance.
- Daily source/ranking checks, archive replay and all fourteen rebuilt archive
  smoke cases passed.
- Real-data checks validated 880 card variants, 1,969 partners and 410 proof-backed
  forged records. The fourteen `-v2` archive cases use three lie cards; the subject
  is the liar in seven cases.
- Comic rendering passed at 1080×1350; the 1200×630 share card was 226,111 bytes.
- The focused private-file scan passed for 237 repository files.

Reports are under `docs/audit/evidence/`; detailed persistent job logs are under
`runs/game-preview/` on the VPS. A prior full release run passed 258 tests with
22 skipped but stopped at a database startup timeout before browser checks or
activation. That timeout allowance is now fixed. The corrected desktop and 360px browser run passed, including keyboard entry,
wrong accusation, X-ray unsealing, restored session, scored reveal, PNG downloads,
collection/profile reload, report, Scam Desk and honest archive verification.
Screenshots were visually reviewed. Final integrated release checks remain required.

## Remaining implementation and release work

Complete a fully keyboard-only solve, cold/daily replay and live-feed recovery
acceptance. The core desktop/mobile browser flow and downloads have passed.
The live worker now logs source failures, stops on canonical conflicts and retries
lost connections, but its installed service still needs a genuine thirty-minute
observation. Run the daily builder without writes and verify its persisted output.
Install cleanup, daily and monitoring services with honest health states.

Release worktrees use an immutable archive snapshot and shared private runtime
data. A release must pass all specified checks before the current-source and
public-static symlinks switch. After activation, check external HTTPS routes,
private-path denials, rollback artifacts and source-edit/restart isolation.

Claude budget/cache/batch/resume/exhaustion plumbing and its offline proofs remain
unfinished. No Claude credit has been spent during this work. Human voice and
clean-label reviews remain pending, as requested by the user.

## Activation requiring the user

No server signing key has been generated and no mainnet write has occurred.
Signer generation requires approval, followed by MON funding, contract deployment
and source verification, the replacement probe and explicit write activation.
Claude needs a locally configured key and approval for each concrete spending
command after offline budget proofs. Telegram alerts need user credentials.
Human audits, the demo video and final submission remain user tasks. Never claim
observation days that have not actually elapsed.

DATABASE_URL is not required: the runtime uses private files. HyperSync and the
source-provider configuration already exist on the VPS. Keep keys, private specs,
source data and execution evidence out of Git and public bundles.
