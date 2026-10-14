import { mkdir, writeFile } from 'node:fs/promises';

const rpc = process.env.MONAD_RPC_HTTP || 'https://rpc.monad.xyz';
const output = new URL('../runs/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const fetchedAt = new Date().toISOString();
const requests = [
  { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
  { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
  { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: '0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763', data: '0x18160ddd' }, 'latest'] },
];
const response = await fetch(rpc, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(requests),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`DATA_RPC_LIMIT: HTTP ${response.status}`);
const replies = await response.json();
await writeFile(new URL('rpc.json', output), JSON.stringify({ fetchedAt, requests, replies }, null, 2));
if (!Array.isArray(replies)) throw new Error('DATA_RPC_REPLY: Expected batch replies');
for (const request of requests) {
  const reply = replies.find(item => item.id === request.id);
  if (!reply || reply.error || typeof reply.result !== 'string') throw new Error(`DATA_RPC_REPLY: ${request.method} failed`);
}
const result = id => replies.find(reply => reply.id === id).result;
if (BigInt(result(1)) !== 143n) throw new Error('DATA_CHAIN: Expected Monad mainnet');
if (BigInt(result(3)) !== 1969n) throw new Error('DATA_SUPPLY: Collection supply differs from 1,969');
console.log(JSON.stringify({ fetchedAt, chainId: Number(BigInt(result(1))), block: Number(BigInt(result(2))), supply: Number(BigInt(result(3))) }));
