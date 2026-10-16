import { mkdir, writeFile } from 'node:fs/promises';
const hashes = ["0x8d144408fae4b78a5d7a42efa85ddf0ec30be2de67e8c05cff2df4a6a5830e3c", "0xdecaddd8a4f17fd6b57cbce9d504cd5b9feb86a64ffd6ef1e1f0632af077495f", "0x89c8e99142bd0c0419d83b79c316c33996a25b497e35c0af7f5958eb33a9a134", "0x0b9b19c489b4f816d0fb9d30029be8743d5cb9d7c870e596713a6cd796394049", "0xb99816a46217e53c5da521b31ce721fd6f751e16cc12bcf3bcc301ab9f07d2bf", "0x3d4c6e6eb9db225e5d493a55f2fa23e2c42b8fc4a0fdec4ee37182a7a660d048", "0x6568b48b64c94150fcd68cb6e9be67e2ec0121e22894d852d63e93fe255837e8", "0x968b2636f5b1ac314fa2ffc657025683ab2cc6c35dd7e8a2d0ea23f0dc240bf2", "0xe3fa036d75423405a28f8f79664906e1623840f7d4507ddd5f2991be88717824", "0xfecca011a4b451d0e55850e29ad324e654a7d547a9a7bdccfe22d8d65259c9b0", "0x31b744745421895718883b39f866c3ba056c4866996cec4475beeee706ea0430", "0xb745cd30bcbdf8131b02b89f2b72b7d78bcc024b048fe0a26a3d683f70b81f81"];
const directory = new URL('../packages/core/test/fixtures/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const tx of hashes) {
  const requests = ['eth_getTransactionByHash', 'eth_getTransactionReceipt'].map((method, id) => ({ jsonrpc: '2.0', id, method, params: [tx] }));
  const fetchedAt = new Date().toISOString();
  const response = await fetch(process.env.MONAD_RPC_HTTP || 'https://rpc.monad.xyz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requests), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`DATA_RPC_LIMIT: HTTP ${response.status}`);
  const replies = await response.json();
  if (!Array.isArray(replies) || requests.some(request => !replies.find(reply => reply.id === request.id)?.result)) throw new Error(`DATA_FIXTURE: Missing reply for ${tx}`);
  await writeFile(new URL(`${tx}.json`, directory), JSON.stringify({ fetchedAt, requests, replies }, null, 2));
  console.log(`Saved ${tx}`);
  await new Promise(resolve => setTimeout(resolve, 500));
}
