import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from './env.mts';
await loadEnv();
if (!process.env.OPENSEA_API_KEY) throw new Error('DATA_OPENSEA_KEY: Set OPENSEA_API_KEY in .env');
const root = new URL('../runs/checks/', import.meta.url);
await mkdir(root, { recursive: true });
const path = '/api/v2/collections/chog-genesis/stats';
const fetchedAt = new Date().toISOString();
const response = await fetch(`https://api.opensea.io${path}`, { headers: { 'X-API-KEY': process.env.OPENSEA_API_KEY, accept: 'application/json', 'user-agent': 'ChogNoir/0.1' }, signal: AbortSignal.timeout(30000) });
const body = await response.text();
const safe = body.replaceAll(process.env.OPENSEA_API_KEY, '[hidden]');
await writeFile(new URL('opensea-stats.json', root), JSON.stringify({ fetchedAt, path, status: response.status, body: safe }, null, 2));
if (!response.ok) { console.error(`DATA_OPENSEA_DOWN: HTTP ${response.status}: ${safe.slice(0, 500)}`); process.exitCode = 1; }
else console.log(safe);
