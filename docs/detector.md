# Detector audit

The saved 30-day window runs from 17 September 2026 07:33:45 UTC through 17 October 2026 07:33:45 UTC. The VPS collected 26,653 ERC-20 records involving all 2,289 nonzero wallets in Chog ownership history at the ending block. Token-symbol queries cover all 433 token contracts.

The initial broad collector includes incoming and outgoing records. Its 913 signer-mismatch candidates must not be treated as 913 forged records. Exactly 576 name an audited wallet as sender; the rest include unrelated sender addresses and six normal incoming vault/redemption records. The detector requires an explicit queried wallet and rejects any record naming a different sender. The six incoming regressions from YZM, sMON and shMON are preserved in tests. The initial suspicion that those six were sender-rule false positives was incorrect; it was a collection-scope mistake.

A signer mismatch alone never produces a finding. The narrow implemented detector requires a successful direct call to the emitting token, a different signer from the queried wallet, positive amount, exactly decoded caller-supplied sender/receiver/amount arrays, and matching execution-time/current bytecode for that transaction. Its conservative opcode analysis excludes any state access, external call, delegation, creation or destruction. It intentionally does not strip compiler metadata: ambiguous code remains unproven rather than risking the removal of executable bytes.

The first public node could not supply 294 of 346 requested execution traces. Those failures remain saved. A second VPS run using [Goldsky’s public Monad RPC](https://goldsky.com/case-studies/monad), `https://rpc2.monad.xyz`, recovered all 346 execution traces and all 346 successful receipts with zero fetch errors. Monad documents historical access in its [historical-data guidance](https://docs.monad.xyz/developer-essentials/historical-data).

The final assessment accepts 410 synthetic records. Every accepted record matches its exact successful receipt log (transaction, block, log index, emitter, topics and amount) and the emitting contract’s execution-time code. All 410 pass these checks; none lack supporting evidence. Six ordinary incoming vault/redemption regressions remain excluded. A12 passes for this tightened, proof-only detector over the saved 30-day corpus: zero unsupported or false-positive findings were identified. This is a bounded verification of the accepted findings, not an estimate of accuracy on future data.

The remaining 166 sender-scoped candidates stay on REVIEW. They cannot be used as a case answer or described as forged. A12 measures false positives and explicitly allows tightening the rules; it does not require detecting every suspicious record. No complete-recall claim, malicious-intent claim or certification of all 576 candidates is made.

The separate symbol check strips combining marks with Unicode NFKD and compares addresses with the stored reference registry. It finds five lookalike token symbols. Plain shared tickers, unknown symbols and canonical reference addresses are not called lookalikes. A lookalike label describes a Unicode/address mismatch; it does not prove a transfer was authorized or identify a malicious person. Symbol reads carry their current fetch times and are not misrepresented as historical symbol snapshots.

[Current audit evidence](audit/evidence/M0-detector-review-20261017.json) records the counts, source window, reference list and proof availability. Raw queries, replies and per-transaction proofs are saved on the selected VPS under `/home/ubuntu/chog-noir-monitor/runs/wallet-audit-20261017/` and in the ignored local `data/wallet-audit/` cache. The collector, symbol scan, proof fetcher and assessment scripts preserve these sources; failed proof requests remain explicit.

No Scam Desk product endpoint is deployed by this audit. The public API currently exposes the M0 health check only. This groundwork does not claim the M8 feature is complete.

## Reproduce the assessment

Keep the saved scan and proof files in `data/wallet-audit/`, then run `node --import tsx scripts/assess-wallet-audit.mts`. On the VPS, fetch execution proofs with `scripts/audit-record-proofs.mts runs/wallet-audit-20261017 --archive` and receipts with `scripts/audit-record-receipts.mts runs/wallet-audit-20261017`. The original provider’s failures and Goldsky’s replies live in separate directories. Offline tests use a saved real receipt and trace, and reject altered code, transaction identity, status, log contents and missing evidence.
