# Wallet sign-in

The wallet service accepts signed messages for Monad mainnet, chain 143. Nonces expire
after five minutes and can be used once. Verification uses the RPC client's
`verifyMessage`, including contract and delegated-account signatures. Sessions last
twelve hours and use an HttpOnly, SameSite=Lax cookie, with Secure on HTTPS origins.
The session secret is sent only in Set-Cookie. Its digest is stored on the server.

| Request | Response |
| --- | --- |
| `POST /auth/nonce` with `{address}` | Message, nonce and expiry to sign |
| `POST /auth/verify` with `{nonce, signature}` | Session cookie and first detective page |
| `GET /me/chogs?after=0&limit=24` | Held Chogs, skills, budgets, careers and source links |

The same paths accept an `/api` prefix. Sign-in POSTs require the configured Origin
and accept at most sixty requests per network per minute. The roster supports up to
fifty Chogs per page and returns `nextCursor` when another page exists. Ownership
snapshots must be less than sixty seconds old. Case handlers use `HolderDirectory.start`
and `HolderDirectory.submission` to confirm the selected detective with `ownerOf`.

The Rookie desk uses a separate cookie and temporary session store. Its badges use
real Chog metadata, exclude the current cast and receive six questions, or eight for
Empath. The store keeps daily browser and network quotas, with hashed identifiers.
Session state expires when the next case opens. A UTC-day quota can survive a case
change until that day ends. Rookie actions cannot write holder careers, shared
statistics, on-chain records or detective tiles.

Run the ownership worker with `corepack pnpm owners:run`. Start the wallet service
with `BUREAU_ORIGIN=https://your-host BUREAU_PORT=8312 corepack pnpm bureau:serve`.
It binds to 127.0.0.1. Put it behind an HTTPS reverse proxy that overwrites X-Real-IP;
forwarded addresses are trusted only from a loopback proxy. The service uses the
stored collection metadata and the finalized snapshot in `runs/owners/snapshot.json`.
`MONAD_OWNER_RPC_HTTP` selects its read-only Monad RPC endpoint.

`connectionsAt(block)` fixes witness links to a case's opening block. A shared wallet
link includes both Chogs' arrival receipts. Mint neighbours are within ten positions
in the ordered mint logs. Rare appearance links require the same original trait value
on no more than five percent of the collection; their text uses clean trait labels.
Tier, Side and the one-of-one Base label never create appearance links. Different
traits that have the same clean label remain different looks. Each link returns its
transfer or stored metadata sources without exposing a wallet address in its text.
