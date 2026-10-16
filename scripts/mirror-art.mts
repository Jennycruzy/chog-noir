import { required, hasErrorCode, errorMessage, type TokenMapping, type Metadata, type StoredMetadata } from './data-types.mts';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = new URL('../data/', import.meta.url);
const contract = '0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763';
const rpc = process.env.MONAD_RPC_HTTP || 'https://rpc.monad.xyz';
const gateway = 'https://ipfs.4everland.io/ipfs/';
const gateways = [gateway, 'https://gateway.pinata.cloud/ipfs/', 'https://ipfs2.seadn.io/ipfs/'];
const unavailableUntil = new Map();
const gatewayOption = process.argv.indexOf('--gateway');
let preferredGateway = gatewayOption >= 0 ? required(process.argv[gatewayOption + 1], 'DATA_GATEWAY_CONFIG: Gateway value missing') : process.env.IPFS_GATEWAY || gateway;
if (!gateways.includes(preferredGateway)) throw new Error('DATA_GATEWAY_CONFIG: Unsupported gateway');
for (const directory of ['metadata/', 'images/', 'replies/']) await mkdir(new URL(directory, root), { recursive: true });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function request(url: string, options?: RequestInit) {
  for (let attempt = 0; attempt < 12; attempt++) {
    let target = url;
    let base;
    if (url.startsWith(gateway)) {
      const candidates = [preferredGateway, ...gateways.filter(item => item !== preferredGateway)];
      base = candidates.find(item => (unavailableUntil.get(item) || 0) <= Date.now());
      if (!base) {
        console.log('DATA_GATEWAY_LIMIT: Waiting for artwork gateways to recover.');
        await pause(30000);
        continue;
      }
      target = base + url.slice(gateway.length);
    }
    try {
      const response = await fetch(target, { ...options, signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        if (base) {
          const retryAfter = Number(response.headers.get('retry-after'));
          unavailableUntil.set(base, Date.now() + Math.max(60000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0));
        }
        throw new Error(`DATA_GATEWAY_HTTP: HTTP ${response.status}`);
      }
      const body = await response.arrayBuffer();
      if (base) preferredGateway = base;
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      if (base && (unavailableUntil.get(base) || 0) <= Date.now()) unavailableUntil.set(base, Date.now() + 60000);
      if (attempt === 11) throw error;
      await pause(Math.min(1000 * 2 ** attempt, 10000));
    }
  }
  throw new Error('DATA_GATEWAY_LIMIT: Retry budget exhausted');
}
function decodeString(hex: string) {
  if (!/^0x[0-9a-f]+$/i.test(hex)) throw new Error('DATA_METADATA: Invalid encoded string');
  const bytes = Buffer.from(hex.slice(2), 'hex');
  const offset = Number(BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`));
  const length = Number(BigInt(`0x${bytes.subarray(offset, offset + 32).toString('hex')}`));
  if (offset + 32 + length > bytes.length) throw new Error('DATA_METADATA: Incomplete string');
  return bytes.subarray(offset + 32, offset + 32 + length).toString('utf8');
}
function ipfs(uri: string) {
  if (!uri.startsWith('ipfs://')) throw new Error('DATA_METADATA: Expected an IPFS address');
  return gateway + uri.slice(7);
}
let map: Record<string, TokenMapping> = {};
try { map = JSON.parse(await readFile(new URL('token_to_file.json', root), 'utf8')); } catch (error) { if (!hasErrorCode(error, 'ENOENT')) throw error; }
for (let start = 1; start <= 1969; start += 20) {
  const ids = Array.from({ length: Math.min(20, 1970 - start) }, (_, index) => start + index).filter(id => !map[id]);
  if (!ids.length) continue;
  const calls = ids.map(id => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: contract, data: '0xc87b56dd' + id.toString(16).padStart(64, '0') }, 'latest'] }));
  const fetchedAt = new Date().toISOString();
  const replies = await (await request(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls) })).json();
  await writeFile(new URL(`replies/uri-${start}.json`, root), JSON.stringify({ fetchedAt, calls, replies }));
  if (!Array.isArray(replies)) throw new Error('DATA_METADATA: Missing batch replies');
  for (const id of ids) {
    const reply = replies.find(item => item.id === id);
    if (!reply?.result || reply.error) throw new Error(`DATA_METADATA: token ${id} failed`);
    const uri = decodeString(reply.result);
    const match = uri.match(/\/(\d+)\.json$/);
    if (!match) throw new Error(`DATA_METADATA: Unexpected URI for ${id}`);
    map[id] = { uri, file: Number(match[1]), fetchedAt };
  }
  await writeFile(new URL('token_to_file.json', root), JSON.stringify(map, null, 2));
  console.log(`Token addresses saved: ${Object.keys(map).length}/1969`);
  await pause(500);
}
if (new Set(Object.values(map).map(item => item.file)).size !== 1969) throw new Error('DATA_METADATA: File mapping is not unique');
let completed = 0;
async function mirror(id: string, item: TokenMapping) {
  const metadataPath = new URL(`metadata/${id}.json`, root);
  let metadata: Metadata;
  try { metadata = (JSON.parse(await readFile(metadataPath, 'utf8')) as StoredMetadata).metadata; } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    metadata = await (await request(ipfs(item.uri))).json();
    if (!metadata.name || !metadata.image || !Array.isArray(metadata.attributes)) throw new Error(`DATA_METADATA: Missing fields for ${id}`);
    await writeFile(metadataPath, JSON.stringify({ fetchedAt: new Date().toISOString(), uri: item.uri, metadata }, null, 2));
  }
  const imagePath = new URL(`images/${id}.webp`, root);
  try { if ((await stat(imagePath)).size === 0) throw new Error('DATA_IMAGE: Empty image'); } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    const bytes = Buffer.from(await (await request(ipfs(metadata.image))).arrayBuffer());
    if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw new Error(`DATA_IMAGE: Invalid WebP for ${id}`);
    const info = await sharp(bytes).metadata();
    if (info.width !== 1000 || info.height !== 1000 || info.format !== 'webp') throw new Error(`DATA_IMAGE: Unexpected dimensions for ${id}`);
    const temporaryPath = new URL(`images/${id}.webp.part`, root);
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, imagePath);
    await writeFile(new URL(`replies/image-${id}.json`, root), JSON.stringify({ fetchedAt: new Date().toISOString(), uri: metadata.image, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: info.width, height: info.height }, null, 2));
  }
  completed++;
  if (completed % 50 === 0) console.log(`Metadata and images saved: ${completed}/1969`);
}
const pending = Object.entries(map);
let cursor = 0;
const failures: Array<{ tokenId: number; code: string; reason: string }> = [];
await Promise.all(Array.from({ length: 2 }, async () => {
  while (cursor < pending.length) {
    const [id, item] = required(pending[cursor++], 'DATA_MIRROR: Work item missing');
    try { await mirror(id, item); }
    catch (error) {
      failures.push({ tokenId: Number(id), code: 'DATA_MIRROR_FAIL', reason: errorMessage(error) });
      console.error(`DATA_MIRROR_FAIL: Token ${id}: ${errorMessage(error)}`);
    }
    await pause(200);
  }
}));
await writeFile(new URL('replies/mirror-summary.json', root), JSON.stringify({ finishedAt: new Date().toISOString(), completed, failures }, null, 2));
if (failures.length) { console.error(`DATA_MIRROR_FAIL: ${failures.length} incomplete tokens; rerun to resume.`); process.exitCode = 1; }
else console.log('All 1,969 metadata records and images saved.');
