import { required, asHex, eventTopics, type StoredHistory } from './data-types.mts';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { HypersyncClient, type Query } from '@envio-dev/hypersync-client';
import { decodeEventLog, type Abi, type Hex } from 'viem';
import { loadEnv } from './env.mts';

await loadEnv();
if (!process.env.HYPERSYNC_TOKEN) throw new Error('DATA_HYPERSYNC_KEY: Key missing');
const address = '0x0c13d51f3d52bb74e4eb131a2ed6978a99a417cf';
const root = new URL('../data/contract-check/', import.meta.url);
await mkdir(root, { recursive: true });
const sourceUrl = `https://monadscan.com/address/${address}`;
const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`DATA_CONTRACT_SOURCE: HTTP ${response.status}`);
const page = await response.text();
await writeFile(new URL('explorer.html', root), page);
const match = page.match(/<pre[^>]*id=['"]js-copytextarea2['"][^>]*>([\s\S]*?)<\/pre>/);
if (!match) throw new Error('DATA_CONTRACT_SOURCE: ABI not found');
const abi = JSON.parse(required(match[1], 'DATA_CONTRACT_SOURCE: ABI text missing').replaceAll('&quot;', '"').replaceAll('&amp;', '&')) as Abi;
if (!Array.isArray(abi) || !abi.some(item => item.type === 'function' && item.name === 'collect')) throw new Error('DATA_CONTRACT_SOURCE: Unexpected ABI');
await writeFile(new URL('abi.json', root), JSON.stringify(abi, null, 2));
const client = new HypersyncClient({ url: 'https://monad.hypersync.xyz', apiToken: process.env.HYPERSYNC_TOKEN });
const height = await client.getHeight();
const stringify = (value: unknown) => JSON.stringify(value, (_, field) => typeof field === 'bigint' ? field.toString() : field, 2);
let fromBlock = 0;
let pageNumber = 0;
interface EscrowEvent { block: number; tx: Hex; logIndex: number; eventName: string; args: Record<string, unknown> }
function uint(args: Record<string, unknown>, name: string): bigint {
  const value = args[name];
  if (typeof value !== 'bigint' || value < 0n) throw new Error(`DATA_ESCROW: Invalid ${name}`);
  return value;
}
function addressArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value)) throw new Error(`DATA_ESCROW: Invalid ${name}`);
  return value;
}
const events: EscrowEvent[] = [];
while (fromBlock < height) {
  const query: Query = { fromBlock, toBlock: height, logs: [{ address: [address] }], fieldSelection: { block: ['Number', 'Timestamp', 'Hash'], log: ['BlockNumber', 'LogIndex', 'TransactionHash', 'Address', 'Data', 'Topic0', 'Topic1', 'Topic2', 'Topic3'] } };
  const fetchedAt = new Date().toISOString();
  const reply = await client.get(query);
  await writeFile(new URL(`contract-page-${pageNumber}.json`, root), stringify({ fetchedAt, query, reply }));
  if (reply.nextBlock <= fromBlock) throw new Error('DATA_HYPERSYNC_REPLY: Pagination did not advance');
  for (const log of reply.data.logs) {
    const decoded = decodeEventLog({ abi, topics: eventTopics(log.topics), data: asHex(log.data) });
    if (typeof decoded !== 'object' || decoded === null || !('eventName' in decoded) || !('args' in decoded) || typeof decoded.eventName !== 'string' || typeof decoded.args !== 'object' || decoded.args === null) throw new Error('DATA_ESCROW: Invalid decoded event');
    events.push({ block: required(log.blockNumber, 'DATA_ESCROW: Block missing'), tx: asHex(log.transactionHash), logIndex: required(log.logIndex, 'DATA_ESCROW: Log index missing'), eventName: decoded.eventName, args: decoded.args as Record<string, unknown> });
  }
  fromBlock = reply.nextBlock;
  pageNumber++;
}
const related = JSON.parse(await readFile(new URL('../data/related/history.json', import.meta.url), 'utf8')) as StoredHistory;
const nft = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const deals = new Map(events.filter(event => event.eventName === 'DealCreated').map(event => [uint(event.args, 'id').toString(), { id: uint(event.args, 'id'), collection: addressArg(event.args, 'collection'), tokenId: uint(event.args, 'tokenId'), payment: addressArg(event.args, 'payment'), amount: uint(event.args, 'amount'), createdTx: event.tx }]));
const linked = [];
for (const event of events.filter(event => event.eventName === 'DealSold')) {
  const deal = deals.get(uint(event.args, 'id').toString());
  if (!deal) throw new Error(`DATA_ESCROW: Missing creation for deal ${event.args.id}`);
  if (deal.collection.toLowerCase() !== nft) continue;
  const transfer = related.data.logs.find(log => log.transactionHash === event.tx && log.address.toLowerCase() === nft && log.topics[3] && BigInt(log.topics[3]) === deal.tokenId);
  if (!transfer) continue;
  linked.push({ id: uint(event.args, 'id'), tokenId: deal.tokenId, payment: deal.payment, amountWei: deal.amount, createdTx: deal.createdTx, soldTx: event.tx, soldLogIndex: event.logIndex });
}
const result = { fetchedAt: new Date().toISOString(), sourceUrl, address, toBlockExclusive: height, counts: events.reduce<Record<string, number>>((counts, event) => ({ ...counts, [event.eventName]: (counts[event.eventName] || 0) + 1 }), {}), linked, events };
await writeFile(new URL('escrow-check.json', root), stringify(result));
console.log(stringify({ counts: result.counts, linkedChogDeals: linked.length, firstChogDeals: linked.slice(0, 3) }));
