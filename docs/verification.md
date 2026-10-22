# Checking a case yourself

Every daily case is locked on chain before it opens. The lock is the hash of the case's
answer key: which witnesses lie, what they claim, which receipt breaks each lie, the
solution, the alternate plans for players whose own Chog is in the case, the id of every
receipt, a hash of the public case file, and a random salt.

1. **Before the case opens**, the daily worker calls `openCase(caseId, answerHash, opensAt, closesAt)`
   on the CaseBook contract. The case is published only after that transaction is final.
2. **While the case is open**, the key stays encrypted on the server. Statements are sent one
   at a time as players press, and sealed receipts only when opened.
3. **After the case closes**, `closeCase(caseId, answerKey)` reveals the exact key text. The
   contract refuses any text whose hash differs from the lock.
4. The cast and every holder's result are then recorded with `recordCast` and
   `recordSolves`, at most 200 detectives per transaction.

`caseId` on chain is `keccak256` of the case id string, for example `case-0123456789abcdef01234567`.

## Check it

Open `/verify/<case id>` on the site, or run

```
corepack pnpm verify <case id>
```

The command reads only public data: the case file from `/api/case/<case id>/public` and the
chain. It checks that

- the `CaseOpened` event carries the published answer hash and times,
- the opening block is earlier than the moment the case was published,
- after close, the `CaseClosed` event reveals text whose `keccak256` is that hash,
- the revealed key names this case, hashes the public case file, and passes the same
  validation the builder runs: every lie is broken by exactly one receipt, no true
  statement is contradicted, the liar pattern matches the day, and every tile is a real value.

It prints `COMMITMENT_VERIFIED` while a case is open and `PASS` once it has closed. Anything
else is a failure.

## Check a receipt

Every receipt names its source transaction, block and log index, and links to the explorer.
Prices are the gross payment from the marketplace's `OrderFulfilled` event, rounded to the
nearest 50 MON unless your detective has the Money Talk passive.
