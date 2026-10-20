# Scam Desk

Scam Desk identifies a narrow class of forged token transfer records involving
Chog wallets. A token contract can emit a record naming a wallet that never signed
the transaction. A signer mismatch alone is insufficient to prove this happened.

A finding requires a successful direct call to the emitting contract, a different
transaction signer from the queried sender, a positive amount, and caller-supplied
sender, receiver and amount arrays that exactly match the receipt log. The
execution-time bytecode must match the analyzed code. Conservative opcode analysis
rejects state access, external calls, delegation, creation and destruction.
Ambiguous records remain unproven and are excluded from findings.

Each finding retains its transaction, block, log index, receipt and execution-code
proof. The stored window is bounded: an empty result does not certify a wallet as
safe and does not describe activity outside the covered dates. Failed source
requests remain explicit. Stored symbols carry fetch times rather than an implied
historical value.

Symbol comparisons use Unicode normalization and a stored reference registry.
A lookalike symbol describes a symbol/address mismatch, not a person's intent.
Ordinary incoming vault and redemption records are covered by regression tests.

Runtime source files stay in ignored data directories on the VPS. Internal
assessment reports are written to private storage. The public endpoint returns
only proof-backed findings and their source links.
