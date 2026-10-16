import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { HypersyncClient, type Query } from '@envio-dev/hypersync-client';
import { loadEnv } from './env.mts';

await loadEnv();
if (!process.argv[2]) throw new Error('SIREN_CHECK_INPUT: Supply the subscription run directory');
if (!process.env.HYPERSYNC_TOKEN) throw new Error('DATA_HYPERSYNC_KEY: Set HYPERSYNC_TOKEN in .env');
const directory = resolve(process.argv[2]);
const summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'));
if (!Number.isSafeInteger(summary.startBlock)) throw new Error('SIREN_CHECK_INPUT: Missing start block');
const records = (await readFile(join(directory, 'events.ndjson'), 'utf8')).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const client = new HypersyncClient({ url: 'https://monad.hypersync.xyz', apiToken: process.env.HYPERSYNC_TOKEN });
const height = await client.getHeight();
const toBlock = Math.min(height, summary.endBlock === undefined ? height : summary.endBlock + 1);
if (!Number.isSafeInteger(toBlock) || toBlock <= summary.startBlock) throw new Error('SIREN_CHECK_RANGE: History has not reached the observation window');
const expected = new Set<string>();
let fromBlock: number = summary.startBlock;
let pages = 0;
while (fromBlock < toBlock) {
  const query: Query = { fromBlock, toBlock,
    logs: [{ address: ['0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763'], topics: [['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']] }],
    fieldSelection: { log: ['BlockNumber', 'TransactionHash', 'LogIndex'] } };
  const fetchedAt = new Date().toISOString();
  const reply = await client.get(query);
  if (!Number.isSafeInteger(reply.nextBlock) || reply.nextBlock <= fromBlock || !Array.isArray(reply.data?.logs)) throw new Error('DATA_HYPERSYNC_REPLY: Invalid comparison page');
  await writeFile(join(directory, `comparison-page-${pages++}.json`), JSON.stringify({ fetchedAt, query, reply }, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  for (const log of reply.data.logs) {
    if (!log.transactionHash || !Number.isSafeInteger(log.logIndex) || !Number.isSafeInteger(log.blockNumber)) throw new Error('SIREN_CHECK_SOURCE: Missing log identity');
    if (log.blockNumber! >= summary.startBlock && log.blockNumber! < toBlock) expected.add(`${log.transactionHash.toLowerCase()}:${log.logIndex}`);
  }
  fromBlock = reply.nextBlock;
}
const observed = new Set<string>();
let duplicates = 0, removed = 0;
for (const record of records) {
  if (record.kind !== 'transfer') continue;
  const event = record.event;
  if (!event || typeof event.transactionHash !== 'string' || typeof event.logIndex !== 'string' || typeof event.blockNumber !== 'string') throw new Error('SIREN_CHECK_LOG: Incomplete received transfer');
  const block = Number(BigInt(event.blockNumber));
  if (block < summary.startBlock || block >= toBlock) continue;
  const key = `${event.transactionHash.toLowerCase()}:${Number(BigInt(event.logIndex))}`;
  if (event.removed === true) { observed.delete(key); removed++; continue; }
  if (observed.has(key)) duplicates++;
  observed.add(key);
}
const missing = [...expected].filter(key => !observed.has(key));
const unexpected = [...observed].filter(key => !expected.has(key));
const fullWindow = summary.complete === true && Number.isSafeInteger(summary.endBlock) && toBlock === summary.endBlock + 1;
const report = { checkedAt: new Date().toISOString(), startedAt: summary.startedAt, finishedAt: summary.finishedAt ?? null,
  status: !fullWindow ? 'IN_PROGRESS' : missing.length || unexpected.length ? 'FAIL' : 'PASS',
  fullWindow, fromBlock: summary.startBlock, toBlockExclusive: toBlock, pages,
  connections: summary.connections, reconnects: summary.reconnects, errors: summary.errors,
  expected: expected.size, received: observed.size, duplicates, removed, missing, unexpected };
await writeFile(join(directory, 'comparison.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
