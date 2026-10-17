import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { HypersyncClient, type Query } from '@envio-dev/hypersync-client';
import { loadEnv } from './env.mts';
import { recoverTransfers, recoveryFilter } from '../packages/indexer/src/recovery.mts';
import type { ChainLog } from '../packages/core/src/chain.mts';

await loadEnv();
if (!process.argv[2]) throw new Error('RECOVERY_INPUT: Supply a completed subscription run directory');
if (!process.env.HYPERSYNC_TOKEN) throw new Error('DATA_HYPERSYNC_KEY: Set HYPERSYNC_TOKEN in .env');
const directory = resolve(process.argv[2]);
const summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'));
if (summary.complete !== true || !Number.isSafeInteger(summary.startBlock) || !Number.isSafeInteger(summary.endBlock)) throw new Error('RECOVERY_INPUT: Run must have a complete observation range');
const client = new HypersyncClient({ url: 'https://monad.hypersync.xyz', apiToken: process.env.HYPERSYNC_TOKEN });
const toBlock = summary.endBlock + 1;
if (await client.getHeight() < toBlock) throw new Error('RECOVERY_HEIGHT: History has not reached the full observation range');
const result = await recoverTransfers({ directory: join(directory, 'recovery'), fromBlock: summary.startBlock, toBlock,
  fetchPage: async (fromBlock, target) => {
    const query: Query = { fromBlock, toBlock: target, logs: [recoveryFilter], fieldSelection: {
      log: ['BlockNumber', 'TransactionHash', 'LogIndex', 'Address', 'Data', 'Topic0', 'Topic1', 'Topic2', 'Topic3'],
    } };
    const fetchedAt = new Date().toISOString();
    const reply = await client.get(query);
    return { fetchedAt, query: { ...query, toBlock: target }, reply: { ...reply, data: { ...reply.data, logs: reply.data.logs as ChainLog[] } } };
  },
});
const events = (await readFile(join(directory, 'events.ndjson'), 'utf8')).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const observed = new Set<string>();
for (const record of events) {
  if (record.kind !== 'transfer') continue;
  const event = record.event;
  const block = Number(BigInt(event.blockNumber));
  if (block < summary.startBlock || block >= toBlock) continue;
  const key = `${event.transactionHash.toLowerCase()}:${Number(BigInt(event.logIndex))}`;
  if (event.removed === true) observed.delete(key); else observed.add(key);
}
const history = new Set(result.logs.map(log => `${log.transactionHash.toLowerCase()}:${log.logIndex}`));
const recovered = [...history].filter(key => !observed.has(key));
const unexpected = [...observed].filter(key => !history.has(key));
const report = { checkedAt: new Date().toISOString(), status: unexpected.length ? 'REVIEW' : 'PASS',
  fromBlock: result.fromBlock, toBlockExclusive: result.nextBlock, pages: result.pages, fetchedPages: result.fetchedPages,
  historyTransfers: history.size, subscriptionTransfers: observed.size, recovered, unexpected,
  note: 'Complete validated transfer logs saved in recovery/page-*.json. This is history recovery, not a subscription completeness pass or a finality guarantee.' };
await writeFile(join(directory, 'recovery-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
