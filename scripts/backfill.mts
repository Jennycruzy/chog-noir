import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from './env.mts';
import { HypersyncClient, type Query, type QueryResponseData } from '@envio-dev/hypersync-client';

await loadEnv();
if (!process.env.HYPERSYNC_TOKEN) throw new Error('DATA_HYPERSYNC_KEY: Set HYPERSYNC_TOKEN in .env');
const endpoint = 'https://monad.hypersync.xyz';
const includeRelated = process.argv.includes('--related');
const root = new URL(includeRelated ? '../data/related/' : '../data/history/', import.meta.url);
await mkdir(root, { recursive: true });
const client = new HypersyncClient({ url: endpoint, apiToken: process.env.HYPERSYNC_TOKEN });
const height = await client.getHeight();
if (!Number.isSafeInteger(height)) throw new Error('DATA_HYPERSYNC_REPLY: Missing height');
const startedAt = new Date().toISOString();
const started = performance.now();
const stringify = (value: unknown) => JSON.stringify(value, (_, field) => typeof field === 'bigint' ? field.toString() : field);
const all: Pick<QueryResponseData, 'blocks' | 'transactions' | 'logs'> = { blocks: [], transactions: [], logs: [] };
let fromBlock = 0;
let pages = 0;
while (fromBlock < height) {
  const query: Query = {
    fromBlock, toBlock: height,
    logs: [{ address: ['0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763'], topics: [['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']] }],
    ...(includeRelated ? { joinMode: 1 } : {}),
    fieldSelection: {
      block: ['Number', 'Hash', 'Timestamp'],
      transaction: ['Hash', 'BlockNumber', 'TransactionIndex', 'From', 'To', 'Input', 'Value', 'Status'],
      log: ['BlockNumber', 'TransactionHash', 'TransactionIndex', 'LogIndex', 'Address', 'Data', 'Topic0', 'Topic1', 'Topic2', 'Topic3'],
    },
  };
  const fetchedAt = new Date().toISOString();
  const reply = await client.get(query);
  await writeFile(new URL(`page-${pages}.json`, root), stringify({ fetchedAt, query, reply }));
  if (!Number.isSafeInteger(reply.nextBlock) || reply.nextBlock <= fromBlock) throw new Error('DATA_HYPERSYNC_REPLY: Pagination did not advance');
  for (const field of ['blocks', 'transactions', 'logs'] as const) {
    if (!Array.isArray(reply.data?.[field])) throw new Error(`DATA_HYPERSYNC_REPLY: Missing ${field}`);

  }
  all.blocks.push(...reply.data.blocks);
  all.transactions.push(...reply.data.transactions);
  all.logs.push(...reply.data.logs);
  fromBlock = reply.nextBlock;
  pages++;
  console.log(`History through block ${fromBlock}/${height}; transfers: ${all.logs.length}`);
}
const summary = { startedAt, finishedAt: new Date().toISOString(), durationSeconds: (performance.now() - started) / 1000, toBlockExclusive: height, pages, counts: Object.fromEntries(Object.entries(all).map(([key, rows]) => [key, rows.length])) };
await writeFile(new URL('history.json', root), stringify({ ...summary, data: all }));
await writeFile(new URL('summary.json', root), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
