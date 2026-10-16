import { required, type HistoryInspection, type StoredHistory, type StoredSales, type StoredOpenSeaStats, type OpenSeaStats } from './data-types.mts';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const inspection = JSON.parse(await readFile(new URL('../runs/checks/history-inspection.json', import.meta.url), 'utf8')) as HistoryInspection;
const history = JSON.parse(await readFile(new URL('../data/related/history.json', import.meta.url), 'utf8')) as StoredHistory;
const feed = JSON.parse(await readFile(new URL('../data/opensea/sales.json', import.meta.url), 'utf8')) as StoredSales;
const statsRecord = JSON.parse(await readFile(new URL('../runs/checks/opensea-stats.json', import.meta.url), 'utf8')) as StoredOpenSeaStats;
const stats = JSON.parse(statsRecord.body) as OpenSeaStats;
const blocks = new Map(history.data.blocks.map(block => [block.number, block.timestamp]));
const cutoff = Math.max(...blocks.values());
if (!Number.isSafeInteger(cutoff)) throw new Error('DATA_RECONCILE: Missing cutoff timestamp');
const chain = [...inspection.candidates, ...inspection.unusual].filter(record => {
  const timestamp = required(blocks.get(record.block), 'DATA_RECONCILE: Block timestamp missing');
  if (!Number.isSafeInteger(timestamp)) throw new Error('DATA_RECONCILE: Payment block missing');
  return timestamp < cutoff;
});
const api = feed.events.filter(event => {
  if (event.event_type !== 'sale' || event.chain !== 'monad' || event.nft?.contract?.toLowerCase() !== '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763' || !Number.isSafeInteger(event.event_timestamp)) throw new Error('DATA_RECONCILE: Unexpected API event');
  return event.event_timestamp < cutoff;
});
const chainPairs = new Set(chain.map(record => `${record.tx.toLowerCase()}:${record.tokenId}`));
const apiPairs = new Set(api.map(event => `${event.transaction.toLowerCase()}:${event.nft.identifier}`));
if (chainPairs.size !== chain.length || apiPairs.size !== api.length) throw new Error('DATA_RECONCILE: Multiple sale legs share a transaction/token pair; review log and order identifiers');
const chainOnly = [...chainPairs].filter(pair => !apiPairs.has(pair));
const apiOnly = [...apiPairs].filter(pair => !chainPairs.has(pair));
const result = {
  checkedAt: new Date().toISOString(),
  cutoffExclusive: new Date(cutoff * 1000).toISOString(),
  scope: 'Transactions before the last stored Chog-event second; boundary-second events excluded on both sides.',
  chainToBlockExclusive: history.toBlockExclusive,
  chainPaidEventPairs: chainPairs.size,
  apiSaleEventPairs: apiPairs.size,
  apiFetchedAt: feed.fetchedAt,
  chainOnly, apiOnly,
  eventFeedMatches: chainOnly.length === 0 && apiOnly.length === 0,
  aggregateStats: { fetchedAt: statsRecord.fetchedAt, totalSales: stats.total.sales, fullApiFeedSales: feed.events.length, differencePercent: 100 * (feed.events.length - stats.total.sales) / stats.total.sales },
  unusualPaidRoutesExcludedFromCases: inspection.unusual.map(record => ({ tx: record.tx, tokenId: record.tokenId, logIndex: record.logIndex })),
  note: 'Matching a marketplace event does not approve a route for a case. The aggregate stats discrepancy remains open.',
};
const root = new URL('../runs/checks/', import.meta.url);
await mkdir(root, { recursive: true });
await writeFile(new URL('sales-reconciliation.json', root), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.eventFeedMatches) process.exitCode = 1;
