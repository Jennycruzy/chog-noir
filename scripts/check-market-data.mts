import { required } from './data-types.mts';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from './env.mts';
await loadEnv();
if (!process.env.OPENSEA_API_KEY) throw new Error('DATA_OPENSEA_KEY: Key missing');
const key = required(process.env.OPENSEA_API_KEY, 'DATA_OPENSEA_KEY: Key missing');
const root = new URL('../data/opensea/', import.meta.url);
await mkdir(root, { recursive: true });
async function get(path: string, filename: string) {
  const fetchedAt = new Date().toISOString();
  const response = await fetch(`https://api.opensea.io${path}`, { headers: { 'X-API-KEY': key, accept: 'application/json', 'user-agent': 'ChogNoir/0.1' }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  const body = JSON.parse(text);
  await writeFile(new URL(filename, root), JSON.stringify({ fetchedAt, path, status: response.status, rateLimit: { limit: response.headers.get('x-ratelimit-limit'), remaining: response.headers.get('x-ratelimit-remaining'), reset: response.headers.get('x-ratelimit-reset') }, body }, null, 2));
  if (!response.ok) throw new Error(`DATA_OPENSEA_DOWN: ${filename} HTTP ${response.status}`);
  return body;
}
for (const [path, filename, field] of [
  ['/api/v2/listings/collection/chog-genesis/all?limit=20', 'listings.json', 'listings'],
  ['/api/v2/offers/collection/chog-genesis/all?limit=20', 'offers.json', 'offers'],
] as const) {
  const body = await get(path, filename);
  if (!Array.isArray(body[field])) throw new Error(`DATA_OPENSEA_REPLY: Missing ${field}`);
  console.log(`${field}: HTTP 200, ${body[field].length} records on first page`);
}
const events = [];
let next;
let page = 0;
const cursors = new Set();
do {
  const params = new URLSearchParams({ event_type: 'sale', limit: '200' });
  if (next) params.set('next', next);
  const body = await get(`/api/v2/events/collection/chog-genesis?${params}`, `sales-${page}.json`);
  if (!Array.isArray(body.asset_events)) throw new Error('DATA_OPENSEA_REPLY: Missing sale events');
  events.push(...body.asset_events);
  next = body.next;
  if (next && cursors.has(next)) throw new Error('DATA_OPENSEA_REPLY: Repeated cursor');
  if (next) cursors.add(next);
  console.log(`Sale events fetched: ${events.length}`);
  page++;
  await new Promise(resolve => setTimeout(resolve, 500));
} while (next);
await writeFile(new URL('sales.json', root), JSON.stringify({ fetchedAt: new Date().toISOString(), pages: page, events }));
console.log(`OpenSea sale history saved: ${events.length} events`);
