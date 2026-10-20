import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { HypersyncClient, type Query } from '@envio-dev/hypersync-client';
import { createHash } from 'node:crypto';
import { loadEnv } from './env.mts';
import { CHOG, TRANSFER_TOPIC, ZERO } from '../packages/core/src/chain.mts';
await loadEnv();
if (!process.env.HYPERSYNC_TOKEN) throw new Error('AUDIT_KEY: HyperSync key missing');
const directory = resolve(process.argv[2] ?? 'runs/wallet-records');
await mkdir(directory, { recursive: true });
const client = new HypersyncClient({ url: 'https://monad.hypersync.xyz', apiToken: process.env.HYPERSYNC_TOKEN });
const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
async function query(request: Query) {
  const id = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const path = join(directory, `${id}.json`);
  try { return JSON.parse(await readFile(path, 'utf8')) as { fetchedAt: string; query: Query; reply: Awaited<ReturnType<typeof client.get>> }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const saved = { fetchedAt: new Date().toISOString(), query: request, reply: await client.get(request) };
  await writeFile(path, json(saved)); return saved;
}
let toBlock: number;
try { toBlock = JSON.parse(await readFile(join(directory, 'height.json'), 'utf8')).toBlock; }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  toBlock = await client.getHeight(); await writeFile(join(directory, 'height.json'), json({ toBlock, fetchedAt: new Date().toISOString() }));
}
async function time(number: number) {
  const page = await query({ fromBlock: number, toBlock: number + 1, includeAllBlocks: true, fieldSelection: { block: ['Number', 'Timestamp'] } });
  const block = page.reply.data.blocks.find(block => block.number === number);
  if (!block || !Number.isSafeInteger(block.timestamp)) throw new Error('AUDIT_BLOCK: Missing source timestamp');
  return block.timestamp!;
}
const endTime = await time(toBlock - 1), startTime = endTime - 30 * 86400;
let low = 0, high = toBlock - 1;
while (low < high) { const mid = Math.floor((low + high) / 2); if (await time(mid) < startTime) low = mid + 1; else high = mid; }
const fromBlock = low;
const wallets = new Set<string>();
let cursor = 0;
while (cursor < toBlock) {
  const page = await query({ fromBlock: cursor, toBlock, logs: [{ address: [CHOG], topics: [[TRANSFER_TOPIC]] }],
    fieldSelection: { log: ['BlockNumber', 'Topic1', 'Topic2'] } });
  if (!Number.isSafeInteger(page.reply.nextBlock) || page.reply.nextBlock <= cursor) throw new Error('AUDIT_PAGE: Non-advancing ownership history');
  for (const log of page.reply.data.logs) for (const topic of log.topics.slice(1, 3)) {
    if (!topic || !/^0x0{24}[0-9a-f]{40}$/i.test(topic)) throw new Error('AUDIT_WALLET: Invalid owner topic');
    const address = `0x${topic.slice(-40)}`.toLowerCase(); if (address !== ZERO) wallets.add(address);
  }
  cursor = page.reply.nextBlock;
}
const addresses = [...wallets].sort();
const candidates: unknown[] = [];
let pages = 0, transfers = 0;
const identities = new Set<string>();
for (let offset = 0; offset < addresses.length; offset += 200) {
  const topics = addresses.slice(offset, offset + 200).map(address => `0x${'0'.repeat(24)}${address.slice(2)}`);
  cursor = fromBlock;
  while (cursor < toBlock) {
    const page = await query({ fromBlock: cursor, toBlock,
      logs: [{ topics: [[TRANSFER_TOPIC], topics] }, { topics: [[TRANSFER_TOPIC], [], topics] }], maxNumLogs: 10000,
      fieldSelection: { block: ['Number', 'Timestamp'], transaction: ['Hash', 'BlockNumber', 'From', 'To', 'Input', 'Status'],
        log: ['Address', 'BlockNumber', 'TransactionHash', 'LogIndex', 'Data', 'Topic0', 'Topic1', 'Topic2', 'Topic3'] } });
    if (!Number.isSafeInteger(page.reply.nextBlock) || page.reply.nextBlock <= cursor || !Array.isArray(page.reply.data.logs)) throw new Error('AUDIT_PAGE: Invalid wallet history page');
    const transactions = new Map(page.reply.data.transactions.map(tx => [tx.hash?.toLowerCase(), tx]));
    for (const log of page.reply.data.logs) {
      if (!log.transactionHash || !Number.isSafeInteger(log.logIndex) || !log.address) throw new Error('AUDIT_LOG: Incomplete source log');
      const id = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
      if (identities.has(id)) continue; identities.add(id);
      const topics = [...log.topics]; while (topics.length && topics.at(-1) == null) topics.pop();
      if (topics.length !== 3 || !/^0x[0-9a-f]{64}$/i.test(log.data ?? '')) continue;
      transfers++;
      const sender = `0x${topics[1]?.slice(-40)}`.toLowerCase();
      const tx = transactions.get(log.transactionHash.toLowerCase());
      if (!tx?.from || !tx.to || !tx.input) throw new Error('AUDIT_TX: Missing joined transaction');
      if (sender !== ZERO && sender !== tx.from.toLowerCase() && tx.to.toLowerCase() === log.address.toLowerCase()) {
        candidates.push({ log, tx, source: { fetchedAt: page.fetchedAt, query: page.query } });
      }
    }
    pages++; cursor = page.reply.nextBlock;
    console.log(json({ phase: 'wallet_scan', wallets: addresses.length, batch: offset / 200, pages, transfers, candidates: candidates.length, nextBlock: cursor, toBlock }));
  }
}
const report = { checkedAt: new Date().toISOString(), status: 'REVIEW_REQUIRED', fromBlock, toBlockExclusive: toBlock,
  startTime: new Date(startTime * 1000).toISOString(), endTimeInclusive: new Date(endTime * 1000).toISOString(),
  walletUniverse: 'All nonzero wallets named in complete Chog ownership history at the fixed ending block',
  wallets: addresses.length, pages, erc20Transfers: transfers, candidateCount: candidates.length,
  note: 'Candidate collection only: signer mismatch is not a forgery finding. Approval, permit, smart-wallet and token-code evidence must be reviewed before labeling. No zero-false-positive claim.' };
await writeFile(join(directory, 'candidates.json'), json(candidates));
await writeFile(join(directory, 'wallets.json'), json(addresses));
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
