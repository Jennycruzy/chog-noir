import { errorMessage } from './data-types.mts';
import WebSocket from 'ws';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { loadEnv } from './env.mts';

await loadEnv();
const startedAt = new Date().toISOString();
const directory = new URL(`../runs/subscription/${startedAt.replace(/[:.]/g, '-')}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const duration = Number(process.env.CHECK_DURATION_SECONDS || 21600);
if (!Number.isFinite(duration) || duration < 1) throw new Error('SIREN_CONFIG: Invalid check duration');
const end = Date.now() + duration * 1000;
const summary: { startedAt: string; durationSeconds: number; connections: number; reconnects: number; subscriptions: number; events: number; errors: number; complete: boolean; startBlock?: number; endBlock?: number; finishedAt?: string } = { startedAt, durationSeconds: duration, connections: 0, reconnects: 0, subscriptions: 0, events: 0, errors: 0, complete: false };
let socket: WebSocket;
let finished = false;
let timer: ReturnType<typeof setInterval> | undefined;
let alive = true;
let writing = Promise.resolve();
function log(record: Record<string, unknown>) {
  writing = writing.then(() => appendFile(new URL('events.ndjson', directory), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n'));
}
async function save() { await writeFile(new URL('summary.json', directory), JSON.stringify(summary, null, 2)); }
function connect() {
  if (finished) return;
  socket = new WebSocket(process.env.MONAD_RPC_WS || 'wss://rpc.monad.xyz', { handshakeTimeout: 15000 });
  socket.on('open', () => {
    summary.connections++;
    summary.reconnects = Math.max(0, summary.connections - 1);
    log({ kind: 'connected' });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] }));
    alive = true;
    timer = setInterval(() => {
      if (!alive) { log({ kind: 'heartbeat_timeout' }); socket.terminate(); return; }
      alive = false;
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, 20000);
  });
  socket.on('pong', () => { alive = true; });
  socket.on('message', bytes => {
    let reply;
    try { reply = JSON.parse(bytes.toString()); } catch { summary.errors++; log({ kind: 'invalid_reply' }); return; }
    if (reply.id === 2 && typeof reply.result === 'string') {
      summary.startBlock ??= Number(BigInt(reply.result));
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['logs', { address: '0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763', topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] }] }));
    }
    else if (reply.id === 1 && typeof reply.result === 'string') { summary.subscriptions++; log({ kind: 'subscribed', id: reply.result }); console.log('Chog transfer subscription accepted.'); }
    else if (reply.error) { summary.errors++; log({ kind: 'rpc_error', error: reply.error }); }
    else if (reply.method === 'eth_subscription') { summary.events++; log({ kind: 'transfer', event: reply.params.result }); console.log(`Transfer received: ${reply.params.result.transactionHash}`); }
  });
  socket.on('error', error => { summary.errors++; log({ kind: 'connection_error', message: errorMessage(error) }); });
  socket.on('close', (code) => {
    clearInterval(timer);
    log({ kind: 'closed', code });
    if (!finished) setTimeout(connect, 5000);
  });
}
async function finish(complete: boolean) {
  if (finished) return;
  finished = true;
  clearInterval(timer);
  clearInterval(checkpoint);
  summary.complete = complete;
  summary.finishedAt = new Date().toISOString();
  if (complete) {
    try {
      const response = await fetch(process.env.MONAD_RPC_HTTP || 'https://rpc.monad.xyz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reply = await response.json();
      if (typeof reply.result !== 'string') throw new Error('Missing final block');
      summary.endBlock = Number(BigInt(reply.result));
    } catch (error) { summary.complete = false; log({ kind: 'end_block_error', message: errorMessage(error) }); }
  }
  socket?.close();
  await writing;
  await save();
  console.log(JSON.stringify(summary));
}
const checkpoint = setInterval(() => { save().catch(error => { console.error(error.message); process.exitCode = 1; }); if (Date.now() >= end) finish(true); }, 10000);
process.on('SIGINT', () => finish(false));
process.on('SIGTERM', () => finish(false));
await save();
connect();
