# Build decisions

## 17 October 2026

- The user requested one branch: merge all committed development work into `main` and remove `data-engine`. Keep unfinished audit items explicit. Commit and push in coherent pieces at substantial milestones, rather than accumulating completed work locally.
- The user approved replacing the original ±1% OpenSea aggregate-count gate with exact chain-to-event reconciliation at a shared cutoff. The refreshed comparison matches all 1,581 transaction/token pairs. Preserve the separate discrepancy: the current complete event feed has 1,595 sales while aggregate stats reports 1,565. Do not describe the aggregate counter as reconciled.
- Use the selected VPS's existing Nginx and Certbot setup for the isolated Chog Noir readiness host, rather than replacing the shared web server with Caddy. A hostname-specific webroot challenge obtains the certificate; the API reports that the indexer stopped after its completed reliability check, rather than implying live indexing.
- Scope sender-forgery checks to the queried wallet before evaluating signer mismatch. Normal incoming vault/redemption records in the broad collector are not sender-side false positives. Require per-transaction execution-time bytecode and exact calldata binding for the narrow synthetic-record finding; keep missing proofs, stateful routes and unknown authorization on review. A Unicode lookalike signal alone is not proof of forgery.

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
- Keep database work on the separate data-engine branch while M0 remains open. The first database change stores source records and enforces payment and ownership consistency; it does not declare disputed events to be sales.
- Test SQL migrations offline with embedded PostgreSQL. Use the PostgreSQL client for deployment, with the connection string read from the local environment and excluded from logs.
- Read offer versus listing from fulfilled order items and their parties. The original router examples contain real Seaport sales. The original delegation example enters the payment-bearing escrow, so it stays unclassified until deal evidence is joined. These factual corrections are recorded privately and in the audit report.
- Include fees in both halves of matched orders. Cross-check the total passed between the orders instead of adding two descriptions of the same payment.
- Preserve original HyperSync requests and fetch times when importing records. Keep absent RPC receipts absent. Reject conflicting source records and roll back the import.
- Derive holding times and counts from the full owner history. A transfer to the same wallet does not restart the hold. Keep gift intent and common wallet control unconfirmed without their separate evidence.

- Join escrow deposits to their funded deal and exact NFT transfer. Verify native payments inside the matching NFT receiver callback, and verify token payments using the official token contract's log. Collection references that earlier payment and never creates a second sale.
- Keep the 32 MON escrow deals and 58 $CHOG escrow deals separate from the Seaport market-price reference. Preserve amounts in their original base units.
- Use Etherscan's complete account histories for payment-window checks because Monad's public RPC supports individual execution traces but does not support filtered trace history. Store all requested pages and enclosing source blocks. The key stays out of the saved query.
- Treat no-payment results as findings for MON and WMON within a stated two-hour window. They do not prove gift intent, common wallet control or absence of payments in other assets.


## 17 October 2026 — detector evidence

- Preserve the original public RPC’s 294 unavailable traces and recover historical execution proofs through Goldsky’s public Monad RPC on the VPS. Save the second provider’s successful receipts separately and compare every accepted record against them.
- Apply A12 to accepted findings from the tightened proof-only detector over the saved 30-day corpus. All 410 accepted records have matching execution and receipt evidence; 166 unresolved candidates remain REVIEW. A12’s zero-false-positive requirement does not imply complete recall. This does not complete the M8 Scam Desk product.


## 19 October 2026 — Witness variation

When no cast member has a trait associated with a shifty witness, the lie planner selects a cast member deterministically from the case salt. Count lies vary by one or two in either direction and stay non-negative. These choices replace the original subject-only fallback and fixed increment so archive practice does not teach a predictable answer pattern. Facts and contradictions still come from the saved source records.
