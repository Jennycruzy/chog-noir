import { resolve } from 'node:path';
import { writeFileSync, renameSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { HypersyncClient, type Query } from '@envio-dev/hypersync-client';
import { loadEnv } from './env.mts';
import { errorMessage } from './data-types.mts';
import { openLiveIndexer } from '../packages/indexer/src/live.mts';
import { recoveryFilter } from '../packages/indexer/src/recovery.mts';
import type { ChainLog } from '../packages/core/src/chain.mts';
import { compareReliability } from '../packages/indexer/src/reliability.mts';

await loadEnv();
const [directory, fromArgument] = process.argv.slice(2);
if (!directory || !fromArgument || (fromArgument !== 'now' && !/^\d+$/.test(fromArgument))) throw new Error('INDEXER_INPUT: Supply a persistent directory and inclusive start block (or now)');
if (!process.env.HYPERSYNC_TOKEN) throw new Error('DATA_HYPERSYNC_KEY: Set HYPERSYNC_TOKEN in .env');
const runSeconds = process.env.INDEXER_RUN_SECONDS === undefined ? undefined : Number(process.env.INDEXER_RUN_SECONDS);
if (runSeconds !== undefined && (!Number.isFinite(runSeconds) || runSeconds < 1 || runSeconds > 86400)) throw new Error('INDEXER_INPUT: Invalid optional run duration');
const client = new HypersyncClient({ url: 'https://monad.hypersync.xyz', apiToken: process.env.HYPERSYNC_TOKEN });
const fromBlock = fromArgument === 'now' ? await client.getHeight() : Number(fromArgument);
const fetchPage = async (fromBlock: number, toBlock: number) => {
    const query: Query = { fromBlock, toBlock, logs: [recoveryFilter], fieldSelection: {
      log: ['BlockNumber', 'TransactionHash', 'LogIndex', 'Address', 'Data', 'Topic0', 'Topic1', 'Topic2', 'Topic3'],
    } };
    const fetchedAt = new Date().toISOString();
    const reply = await client.get(query);
    return { fetchedAt, query: { ...query, toBlock }, reply: { ...reply, data: { ...reply.data, logs: reply.data.logs as ChainLog[] } } };
  };
const indexer = await openLiveIndexer({ directory: resolve(directory), fromBlock, getHeight: () => client.getHeight(), fetchPage,
});
const startedAt = new Date().toISOString();
const run = { startedAt, plannedEndAt: runSeconds === undefined ? null : new Date(Date.now() + runSeconds * 1000).toISOString(),
  durationSeconds: runSeconds ?? null, fromBlock, state: 'RUNNING', connections: 0, subscriptions: 0, disconnects: 0, messages: 0, errors: 0, syncs: 0, finishedAt: null as string | null };
function saveRun() {
  writeFileSync(resolve(directory!, 'run-summary.json.tmp'), JSON.stringify(run, null, 2));
  renameSync(resolve(directory!, 'run-summary.json.tmp'), resolve(directory!, 'run-summary.json'));
}
saveRun();
let stopped = false, syncing = false;
let socket: WebSocket | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let subscription: string | undefined;
function failure(error: unknown) { run.errors++; console.error(JSON.stringify({ kind: 'indexer_error', message: errorMessage(error) })); }
async function sync() {
  if (stopped || syncing) return;
  syncing = true;
  try {
    const result = await indexer.sync();
    run.syncs++;
    saveRun();
    const { logs, ...summary } = result;
    console.log(JSON.stringify({ kind: 'history_sync', ...summary }));
  } catch (error) { failure(error); }
  finally { syncing = false; }
}
function connect() {
  if (stopped) return;
  const connection = new WebSocket(process.env.MONAD_RPC_WS || 'wss://rpc.monad.xyz', { handshakeTimeout: 15000 });
  socket = connection;
  let alive = true;
  subscription = undefined;
  connection.on('open', () => {
    run.connections++;
    connection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['logs', recoveryFilter] }));
    watchdog = setTimeout(() => { failure(new Error('INDEXER_SUBSCRIBE: No acknowledgement')); connection.terminate(); }, 15000);
    heartbeat = setInterval(() => {
      if (!alive) { connection.terminate(); return; }
      alive = false;
      connection.ping();
    }, 20000);
    void sync();
  });
  connection.on('pong', () => { alive = true; });
  connection.on('message', bytes => {
    if (stopped) return;
    try {
      const reply = JSON.parse(bytes.toString());
      if (reply.error) { failure(new Error('INDEXER_RPC: Subscription rejected')); connection.terminate(); return; }
      if (reply.id === 1 && typeof reply.result === 'string') {
        subscription = reply.result;
        run.subscriptions++;
        clearTimeout(watchdog);
        console.log(JSON.stringify({ kind: 'subscribed' }));
        void sync();
      } else if (reply.method === 'eth_subscription' && reply.params?.subscription === subscription) {
        const raw = reply.params.result;
        run.messages++;
        const log: ChainLog = { ...raw, blockNumber: Number(BigInt(raw.blockNumber)), logIndex: Number(BigInt(raw.logIndex)) };
        void indexer.observe(log).then(() => sync()).catch(error => { failure(error); connection.terminate(); });
      }
    } catch (error) { failure(error); connection.terminate(); }
  });
  connection.on('error', failure);
  connection.on('close', () => {
    run.disconnects++;
    clearInterval(heartbeat);
    clearTimeout(watchdog);
    void sync();
    if (!stopped) reconnect = setTimeout(connect, 5000);
  });
}
const polling = setInterval(() => { void sync(); }, 10000);
const stopTimer = runSeconds === undefined ? undefined : setTimeout(() => { void stop(true).catch(failure); }, runSeconds * 1000);
async function stop(complete = false) {
  if (stopped) return;
  stopped = true;
  clearTimeout(stopTimer);
  clearInterval(polling); clearInterval(heartbeat); clearTimeout(reconnect); clearTimeout(watchdog);
  socket?.terminate();
  run.state = 'FINALIZING';
  saveRun();
  try {
    const snapshot = await indexer.sync();
    // Fresh full-window requests deliberately bypass the incremental checkpoint.
    const reference: ChainLog[] = [];
    let cursor = fromBlock, pages = 0;
    while (cursor < snapshot.toBlockExclusive) {
      const page = await fetchPage(cursor, snapshot.toBlockExclusive);
      if (!Number.isSafeInteger(page.reply.nextBlock) || page.reply.nextBlock <= cursor || page.reply.nextBlock > snapshot.toBlockExclusive || !Array.isArray(page.reply.data.logs)) throw new Error('RELIABILITY_PAGE: Invalid reference pagination');
      await writeFile(resolve(directory!, `reference-page-${pages++}.json`), JSON.stringify(page, (_, value) => typeof value === 'bigint' ? value.toString() : value));
      reference.push(...page.reply.data.logs);
      cursor = page.reply.nextBlock;
    }
    const report = compareReliability({ complete, startedAt, finishedAt: new Date().toISOString(), durationSeconds: runSeconds ?? 21600,
      fromBlock, toBlockExclusive: snapshot.toBlockExclusive, status: snapshot.status, stored: snapshot.logs, reference });
    await writeFile(resolve(directory!, 'reliability-report.json'), JSON.stringify({ ...report, referencePages: pages, metrics: run }, null, 2));
    run.state = report.status;
    if (report.status === 'FAIL') process.exitCode = 1;
  } catch (error) { failure(error); run.state = 'ERROR'; process.exitCode = 1; }
  finally {
    await indexer.close();
    run.finishedAt = new Date().toISOString();
    saveRun();
    console.log(JSON.stringify({ kind: 'finished', ...run }));
  }
}
process.on('SIGINT', () => { void stop().catch(failure); });
process.on('SIGTERM', () => { void stop().catch(failure); });
void sync();
connect();
