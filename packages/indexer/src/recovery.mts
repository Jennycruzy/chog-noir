import { access, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CHOG, TRANSFER_TOPIC, decodeTransfer, type ChainLog } from '../../core/src/chain.mts';
import { withFileLock, PlayerBusy } from '../../game/src/player-lock.mts';

export interface RecoveryPage {
  fetchedAt: string;
  query: { fromBlock: number; toBlock: number };
  reply: { nextBlock: number; data: { logs: ChainLog[] } };
}
// Version 2 carries the validated transfers, so a resume reads one file instead of every saved page.
interface Checkpoint { version: 1 | 2; fromBlock: number; nextBlock: number; pages: number; transfers: number; logs?: ChainLog[] }
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

const pagesChecked = new Map<string, number>();
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
  // One writer at a time. The kernel lock disappears with a crashed writer, so it can never strand the indexer.
  try { return await withFileLock(join(directory, 'writer.lock'), async () => {
    let state: Checkpoint = { version: 1, fromBlock, nextBlock: fromBlock, pages: 0, transfers: 0 };
    try { state = JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (![1, 2].includes(state.version) || state.fromBlock !== fromBlock || !validBlock(state.nextBlock) || state.nextBlock < fromBlock ||
        state.nextBlock > toBlock || !validBlock(state.pages) || !validBlock(state.transfers)) throw new Error('RECOVERY_CHECKPOINT: Invalid or incompatible checkpoint');
    const logs = new Map<string, ChainLog>();
    if (state.version === 2) {
      if (!Array.isArray(state.logs)) throw new Error('RECOVERY_CHECKPOINT: Invalid or incompatible checkpoint');
      for (const log of state.logs) {
        decodeTransfer(log);
        if (log.blockNumber < fromBlock || log.blockNumber >= state.nextBlock) throw new Error('RECOVERY_RANGE: Log outside covered range');
        logs.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log);
      }
      if (logs.size !== state.transfers) throw new Error('RECOVERY_CHECKPOINT: Source records disagree with checkpoint');
      // The saved source pages are the evidence behind the checkpoint; each must still exist. A process checks each page
      // once and then only the pages added since, so the cost does not grow with every cycle.
      const checked = pagesChecked.get(directory) ?? 0;
      for (let index = checked > state.pages ? 0 : checked; index < state.pages; index++) await access(join(directory, `page-${index}.json`)).catch(() => { throw new Error('RECOVERY_CHECKPOINT: A saved source page is missing'); });
      pagesChecked.set(directory, state.pages);
    } else {
      let cursor = fromBlock;
      for (let index = 0; index < state.pages; index++) {
        const page: RecoveryPage = JSON.parse(await readFile(join(directory, `page-${index}.json`), 'utf8'));
        validate(page, cursor, page.query.toBlock);
        if (page.query.toBlock > toBlock) throw new Error('RECOVERY_CHECKPOINT: Saved page beyond target');
        merge(logs, page);
        cursor = page.reply.nextBlock;
      }
      if (cursor !== state.nextBlock || logs.size !== state.transfers) throw new Error('RECOVERY_CHECKPOINT: Source records disagree with checkpoint');
    }
    let fetchedPages = 0;
    while (state.nextBlock < toBlock) {
      const page = await fetchPage(state.nextBlock, toBlock);
      validate(page, state.nextBlock, toBlock);
      merge(logs, page);
      await atomic(join(directory, `page-${state.pages}.json`), page);
      state = { version: 2, fromBlock, nextBlock: page.reply.nextBlock, pages: state.pages + 1, transfers: logs.size, logs: [...logs.values()] };
      await atomic(join(directory, 'checkpoint.json'), state);
      fetchedPages++;
    }
    if (state.version === 1) { state = { ...state, version: 2, logs: [...logs.values()] }; await atomic(join(directory, 'checkpoint.json'), state); }
    const { logs: _saved, ...summary } = state;
    return { ...summary, fetchedPages, logs: [...logs.values()].sort((a,b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex) };
  }, 0); } catch (error) {
    if (error instanceof PlayerBusy) throw Object.assign(new Error('RECOVERY_BUSY: Another writer is recovering this history'), { code: 'RECOVERY_BUSY' });
    throw error;
  }
}

export const recoveryFilter = { address: [CHOG], topics: [[TRANSFER_TOPIC]] };
