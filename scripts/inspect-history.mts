import { required, eventTopics, type StoredHistory, type SeaportOrder, type SeaportItem, type PaymentCandidate, type StoredOpenSeaStats, type OpenSeaStats } from './data-types.mts';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseAbi, decodeEventLog } from 'viem';

const history = JSON.parse(await readFile(new URL('../data/history/history.json', import.meta.url), 'utf8')) as StoredHistory;
const related = JSON.parse(await readFile(new URL('../data/related/history.json', import.meta.url), 'utf8')) as StoredHistory;
const chog = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const seaport = '0x0000000000000068f116a894984e2db1123eb395';
const wmon = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const zero = '0x' + '0'.repeat(40);
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const abi = parseAbi(['event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, (uint8 itemType, address token, uint256 identifier, uint256 amount)[] offer, (uint8 itemType, address token, uint256 identifier, uint256 amount, address recipient)[] consideration)']);
const blocks = new Map(history.data.blocks.map(block => [block.number, block]));
const transactions = new Map(related.data.transactions.map(tx => [tx.hash, tx]));
const logs = related.data.logs.filter(log => log.address.toLowerCase() === chog && log.topics[0] === transferTopic);
const unique = new Map(logs.map(log => [`${log.transactionHash}:${log.logIndex}`, log]));
const mints = [...unique.values()].filter(log => log.topics[1] === '0x' + '0'.repeat(64));
const first = mints.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)[0];
if (!first || !blocks.has(first.blockNumber)) throw new Error('DATA_MINT: Mint or block missing');
const orders = new Map<string, Array<SeaportOrder & { logIndex: number }>>();
for (const log of related.data.logs.filter(log => log.address.toLowerCase() === seaport)) {
  if (!log.topics[0]?.startsWith('0x9d9af8e3')) continue;
  const decoded = decodeEventLog({ abi, data: log.data, topics: eventTopics(log.topics) });
  const current = orders.get(log.transactionHash) || [];
  current.push({ logIndex: log.logIndex, ...decoded.args });
  orders.set(log.transactionHash, current);
}
const candidates: PaymentCandidate[] = [];
const unusual: PaymentCandidate[] = [];
for (const log of unique.values()) {
  const tokenId = BigInt(required(log.topics[3], 'DATA_TRANSFER: Missing token topic'));
  const from = '0x' + required(log.topics[1], 'DATA_TRANSFER: Missing sender topic').slice(-40);
  if (from === zero) continue;
  const events = orders.get(log.transactionHash) || [];
  const hasChog = (item: SeaportItem) => item.token.toLowerCase() === chog && item.identifier === tokenId;
  const matches = events.filter(event => [...event.offer, ...event.consideration].some(hasChog));
  const payments = matches.flatMap(event => {
    const direct = event.consideration.filter(item => item.itemType <= 1 && item.recipient.toLowerCase() === from && (item.itemType === 0 || item.token.toLowerCase() === wmon) && item.amount > 0n);
    const offered = event.recipient.toLowerCase() === from
      ? event.offer.filter(item => item.itemType <= 1 && (item.itemType === 0 || item.token.toLowerCase() === wmon) && item.amount > 0n).map(item => {
        const fees = event.consideration.filter(fee => fee.itemType === item.itemType && fee.token.toLowerCase() === item.token.toLowerCase() && fee.recipient.toLowerCase() !== from).reduce((sum, fee) => sum + fee.amount, 0n);
        if (fees >= item.amount) throw new Error('PRICE_ALLOCATION: Fees exhaust the offered amount');
        return { ...item, amount: item.amount - fees };
      }) : [];
    return [...direct, ...offered];
  });
  if (!payments.length) continue;
  const sameNftBothSides = matches.some(event => event.offer.some(hasChog) && event.consideration.some(hasChog));
  const record = { tx: log.transactionHash, tokenId: tokenId.toString(), logIndex: log.logIndex, block: log.blockNumber, selector: transactions.get(log.transactionHash)?.input?.slice(0, 10), sellerAmountsWei: payments.map(item => item.amount.toString()) };
  (sameNftBothSides ? unusual : candidates).push(record);
}
const statsRecord = JSON.parse(await readFile(new URL('../runs/checks/opensea-stats.json', import.meta.url), 'utf8')) as StoredOpenSeaStats;
const stats = JSON.parse(statsRecord.body) as OpenSeaStats;
const output = {
  inspectedAt: new Date().toISOString(),
  historyThroughExclusive: related.toBlockExclusive,
  firstMint: { block: first.blockNumber, time: new Date(required(blocks.get(first.blockNumber), 'DATA_MINT: Block missing').timestamp * 1000).toISOString(), tx: first.transactionHash },
  mintCount: mints.length, uniqueMintedTokens: new Set(mints.map(log => log.topics[3])).size,
  transferCount: unique.size, candidatePaidTransfers: candidates.length,
  unusualPaidTransfers: unusual.length, openseaSales: stats.total.sales,
  differencePercent: 100 * (candidates.length - stats.total.sales) / stats.total.sales,
  note: 'Payment candidates are not final sale classifications. Unusual routes require review.',
  candidates, unusual,
};
const root = new URL('../runs/checks/', import.meta.url);
await mkdir(root, { recursive: true });
await writeFile(new URL('history-inspection.json', root), JSON.stringify(output, null, 2));
const { candidates: _, unusual: __, ...summary } = output;
console.log(JSON.stringify(summary, null, 2));
