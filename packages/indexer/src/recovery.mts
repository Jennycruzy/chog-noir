import { mkdir, readFile, writeFile, rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CHOG, TRANSFER_TOPIC, decodeTransfer, type ChainLog } from '../../core/src/chain.mts';

export interface RecoveryPage {
  fetchedAt: string;
  query: { fromBlock: number; toBlock: number };
  reply: { nextBlock: number; data: { logs: ChainLog[] } };
}
interface Checkpoint { version: 1; fromBlock: number; nextBlock: number; pages: number; transfers: number }
const stringify = (value: unknown) => JSON.stringify(value, (_, field) => typeof field === 'bigint' ? field.toString() : field);
const validBlock = (value: number) => Number.isSafeInteger(value) && value >= 0;
async function atomic(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, stringify(value));
  await rename(`${path}.tmp`, path);
}
function validate(page: RecoveryPage, from: number, to: number) {
  if (!Number.isFinite(Date.parse(page.fetchedAt)) || page.query.fromBlock !== from || page.query.toBlock !== to ||
      !validBlock(page.reply.nextBlock) || page.reply.nextBlock <= from || page.reply.nextBlock > to || !Array.isArray(page.reply.data?.logs)) {
    throw new Error('RECOVERY_PAGE: Invalid source or pagination');
  }
  for (const log of page.reply.data.logs) {
    decodeTransfer(log);
    if (log.blockNumber < from || log.blockNumber >= page.reply.nextBlock) throw new Error('RECOVERY_RANGE: Log outside covered range');
  }
}
function merge(logs: Map<string, ChainLog>, page: RecoveryPage) {
  for (const log of page.reply.data.logs) {
    const key = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
    const previous = logs.get(key);
    if (previous && JSON.stringify(decodeTransfer(previous)) !== JSON.stringify(decodeTransfer(log))) throw new Error('RECOVERY_CONFLICT: Changed transfer identity');
    logs.set(key, log);
  }
}

// Only pages referenced by the atomically replaced checkpoint are committed.
// A crash after saving a page but before its checkpoint leaves an ignored page,
// which is replaced when that range is fetched again.
export async function recoverTransfers(options: {
  directory: string; fromBlock: number; toBlock: number;
  fetchPage: (fromBlock: number, toBlock: number) => Promise<RecoveryPage>;
}) {
  const { directory, fromBlock, toBlock, fetchPage } = options;
  if (!validBlock(fromBlock) || !validBlock(toBlock) || toBlock < fromBlock) throw new Error('RECOVERY_RANGE: Invalid block range');
  await mkdir(directory, { recursive: true });
  const lock = join(directory, '.lock');
  await mkdir(lock); // One writer; never remove another process's lock.
  try {
    let state: Checkpoint = { version: 1, fromBlock, nextBlock: fromBlock, pages: 0, transfers: 0 };
    try { state = JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (state.version !== 1 || state.fromBlock !== fromBlock || !validBlock(state.nextBlock) || state.nextBlock < fromBlock ||
        state.nextBlock > toBlock || !validBlock(state.pages) || !validBlock(state.transfers)) throw new Error('RECOVERY_CHECKPOINT: Invalid or incompatible checkpoint');
    const logs = new Map<string, ChainLog>();
    let cursor = fromBlock;
    for (let index = 0; index < state.pages; index++) {
      const page: RecoveryPage = JSON.parse(await readFile(join(directory, `page-${index}.json`), 'utf8'));
      validate(page, cursor, page.query.toBlock);
      if (page.query.toBlock > toBlock) throw new Error('RECOVERY_CHECKPOINT: Saved page beyond target');
      merge(logs, page);
      cursor = page.reply.nextBlock;
    }
    if (cursor !== state.nextBlock || logs.size !== state.transfers) throw new Error('RECOVERY_CHECKPOINT: Source records disagree with checkpoint');
    let fetchedPages = 0;
    while (state.nextBlock < toBlock) {
      const page = await fetchPage(state.nextBlock, toBlock);
      validate(page, state.nextBlock, toBlock);
      merge(logs, page);
      await atomic(join(directory, `page-${state.pages}.json`), page);
      state = { ...state, nextBlock: page.reply.nextBlock, pages: state.pages + 1, transfers: logs.size };
      await atomic(join(directory, 'checkpoint.json'), state);
      fetchedPages++;
    }
    return { ...state, fetchedPages, logs: [...logs.values()].sort((a,b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex) };
  } finally { await rmdir(lock); }
}

export const recoveryFilter = { address: [CHOG], topics: [[TRANSFER_TOPIC]] };
