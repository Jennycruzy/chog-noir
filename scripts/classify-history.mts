import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { classifyTransaction } from '../packages/core/src/classify.mts';
import { enrichHistory } from '../packages/core/src/enrich.mts';
import { buildOwnership } from '../packages/core/src/owners.mts';
import { type ChainLog, CHOG, TRANSFER_TOPIC } from '../packages/core/src/chain.mts';
import { required, type StoredHistory } from './data-types.mts';
const history = JSON.parse(await readFile(new URL('../data/related/history.json', import.meta.url), 'utf8')) as StoredHistory;
const byTx = new Map<string, ChainLog[]>();
for (const log of history.data.logs) {
  const list = byTx.get(log.transactionHash) ?? [];
  list.push(log);
  byTx.set(log.transactionHash, list);
}
const events = history.data.transactions.flatMap(tx => classifyTransaction(tx, required(byTx.get(tx.hash), 'DATA_HISTORY: Transaction logs missing')));
const transferCount = history.data.logs.filter(log => log.address.toLowerCase() === CHOG && log.topics[0] === TRANSFER_TOPIC).length;
if (events.length !== transferCount) throw new Error('DATA_HISTORY: Some transfers lack a transaction');
const times = new Map(history.data.blocks.map(block => [block.number, block.timestamp]));
const owners = buildOwnership(events, times);
const enriched=enrichHistory(events,times);
const start = Date.parse('2026-09-29T21:00:00Z')/1000;
const end = Date.parse('2026-10-13T21:00:00Z')/1000;
const windowEvents = events.filter(event => { const time = required(times.get(event.block), 'DATA_HISTORY: Block missing'); return time >= start && time < end; });
function counts(rows: typeof events) { return rows.reduce<Record<string,number>>((result,row) => { result[row.class]=(result[row.class]??0)+1; return result; },{}); }
const report = { generatedAt: new Date().toISOString(), sourceFetchedAt: history.finishedAt, toBlockExclusive: history.toBlockExclusive, transferCount: events.length, counts: counts(events), ownershipRecords: owners.length, currentTokens: owners.filter(owner => !owner.departure).length, researchWindow: { start: new Date(start*1000).toISOString(), end: new Date(end*1000).toISOString(), transfers: windowEvents.length, tokens: new Set(windowEvents.map(event => event.tokenId)).size, counts: counts(windowEvents) }, unknown: events.filter(event => event.class==='UNCLASSIFIED') };
const directory = new URL('../runs/classification/', import.meta.url);
await mkdir(directory, {recursive:true});
await writeFile(new URL('events.json', directory), JSON.stringify({ generatedAt: report.generatedAt, sourceFetchedAt: history.finishedAt, events },null,2));
await writeFile(new URL('enriched.json',directory),JSON.stringify({generatedAt:report.generatedAt,events:enriched},null,2));
await writeFile(new URL('owners.json', directory), JSON.stringify({ generatedAt: report.generatedAt, owners },null,2));
await writeFile(new URL('report.json', directory), JSON.stringify(report,null,2));
const {unknown,...summary}=report;
console.log(JSON.stringify({...summary,unclassified:unknown.length},null,2));
