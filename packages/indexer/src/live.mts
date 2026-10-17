import { mkdir, readFile, writeFile, rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeTransfer, type ChainLog } from '../../core/src/chain.mts';
import { recoverTransfers, type RecoveryPage } from './recovery.mts';

interface Observations { version: 1; fromBlock: number; logs: ChainLog[]; removed: ChainLog[] }
const identity = (log: ChainLog) => `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
async function atomic(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value));
  await rename(`${path}.tmp`, path);
}

// WebSocket messages are provisional. Only contiguous, saved history pages
// advance coverage and enter the canonical snapshot.
export async function openLiveIndexer(options: {
  directory: string; fromBlock: number;
  getHeight: () => Promise<number>;
  fetchPage: (fromBlock: number, toBlock: number) => Promise<RecoveryPage>;
}) {
  const { directory, fromBlock, getHeight, fetchPage } = options;
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error('INDEXER_RANGE: Invalid start block');
  await mkdir(directory, { recursive: true });
  const lock = join(directory, '.monitor-lock');
  await mkdir(lock);
  let observations: Observations;
  try {
    try { observations = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      observations = { version: 1, fromBlock, logs: [], removed: [] };
      await atomic(join(directory, 'observations.json'), observations);
    }
    if (observations.version !== 1 || observations.fromBlock !== fromBlock || !Array.isArray(observations.logs) || !Array.isArray(observations.removed)) throw new Error('INDEXER_STATE: Incompatible observation state');
    for (const log of [...observations.logs, ...observations.removed]) decodeTransfer({ ...log, removed: false });
  } catch (error) { await rmdir(lock); throw error; }
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('INDEXER_CLOSED'));
    const next = tail.then(operation);
    tail = next.catch(() => {}); // A failed network request must not poison retries.
    return next;
  }
  return {
    observe(log: ChainLog) {
      return enqueue(async () => {
        decodeTransfer({ ...log, removed: false });
        if (log.blockNumber < fromBlock) return;
        const key = identity(log);
        const previous = [...observations.logs, ...observations.removed].find(item => identity(item) === key);
        if (previous && JSON.stringify(decodeTransfer({ ...previous, removed: false })) !== JSON.stringify(decodeTransfer({ ...log, removed: false }))) throw new Error('INDEXER_CONFLICT: Changed live transfer');
        const logs = new Map(observations.logs.map(item => [identity(item), item]));
        const removed = new Map(observations.removed.map(item => [identity(item), item]));
        if (log.removed) { logs.delete(key); removed.set(key, log); }
        else logs.set(key, log);
        // Retain removal evidence even if the provider later re-adds the log.
        const updated: Observations = { version: 1, fromBlock, logs: [...logs.values()], removed: [...removed.values()] };
        await atomic(join(directory, 'observations.json'), updated);
        observations = updated;
        if (log.removed) await atomic(join(directory, 'snapshot.json'), { status: 'REVIEW', reason: 'Live removal requires a history rebuild and review', removed: [...removed.keys()] });
      });
    },
    sync() {
      return enqueue(async () => {
        const height = await getHeight();
        if (!Number.isSafeInteger(height) || height < fromBlock) throw new Error('INDEXER_HEIGHT: History is behind start block');
        const result = await recoverTransfers({ directory: join(directory, 'recovery'), fromBlock, toBlock: height, fetchPage });
        const history = new Map(result.logs.map(log => [identity(log), log]));
        const observed = new Set(observations.logs.map(identity));
        const unexpected = observations.logs.filter(log => log.blockNumber < height && !history.has(identity(log))).map(identity);
        const conflicting = observations.logs.filter(log => {
          const saved = history.get(identity(log));
          return saved && JSON.stringify(decodeTransfer(saved)) !== JSON.stringify(decodeTransfer(log));
        }).map(identity);
        const removed = observations.removed.filter(log => log.blockNumber < height).map(identity);
        const snapshot = { checkedAt: new Date().toISOString(), status: unexpected.length || conflicting.length || removed.length ? 'REVIEW' : 'PASS',
          fromBlock, toBlockExclusive: result.nextBlock, transfers: result.transfers, fetchedPages: result.fetchedPages,
          recovered: result.logs.filter(log => !observed.has(identity(log))).map(identity), unexpected, conflicting, removed,
          pending: observations.logs.filter(log => log.blockNumber >= height).map(identity), logs: result.logs };
        await atomic(join(directory, 'snapshot.json'), snapshot);
        return snapshot;
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await tail;
      await rmdir(lock);
    },
  };
}
