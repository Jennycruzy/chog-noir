import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';

const root = new URL('../data/', import.meta.url);
const contract = '0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763';
const rpc = process.env.MONAD_RPC_HTTP || 'https://rpc.monad.xyz';
const gateway = 'https://ipfs.4everland.io/ipfs/';
for (const directory of ['metadata/', 'images/', 'replies/']) await mkdir(new URL(directory, root), { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(url, options) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const target = attempt > 0 && url.startsWith(gateway)
        ? url.replace(gateway, 'https://gateway.pinata.cloud/ipfs/') : url;
      const response = await fetch(target, { ...options, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === 5) throw error;
      await pause(1000 * 2 ** attempt);
    }
  }
}
function decodeString(hex) {
  if (!/^0x[0-9a-f]+$/i.test(hex)) throw new Error('DATA_METADATA: Invalid encoded string');
  const bytes = Buffer.from(hex.slice(2), 'hex');
  const offset = Number(BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`));
  const length = Number(BigInt(`0x${bytes.subarray(offset, offset + 32).toString('hex')}`));
  if (offset + 32 + length > bytes.length) throw new Error('DATA_METADATA: Incomplete string');
  return bytes.subarray(offset + 32, offset + 32 + length).toString('utf8');
}
function ipfs(uri) {
  if (!uri.startsWith('ipfs://')) throw new Error('DATA_METADATA: Expected an IPFS address');
  return gateway + uri.slice(7);
}
let map = {};
try { map = JSON.parse(await readFile(new URL('token_to_file.json', root), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
for (const [id, item] of Object.entries(map)) {
  const metadataPath = new URL(`metadata/${id}.json`, root);
  let metadata;
  try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    metadata = await (await request(ipfs(item.uri))).json();
    if (!metadata.name || !metadata.image || !Array.isArray(metadata.attributes)) throw new Error(`DATA_METADATA: Missing fields for ${id}`);
    await writeFile(metadataPath, JSON.stringify({ fetchedAt: new Date().toISOString(), uri: item.uri, metadata }, null, 2));
  }
  metadata = metadata.metadata || metadata;
  const imagePath = new URL(`images/${id}.webp`, root);
  try { if ((await stat(imagePath)).size === 0) throw new Error('DATA_IMAGE: Empty image'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const bytes = Buffer.from(await (await request(ipfs(metadata.image))).arrayBuffer());
    if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw new Error(`DATA_IMAGE: Invalid WebP for ${id}`);
    await writeFile(imagePath, bytes);
  }
  completed++;
  if (completed % 50 === 0) console.log(`Metadata and images saved: ${completed}/1969`);
}
console.log('All 1,969 metadata records and images saved.');
