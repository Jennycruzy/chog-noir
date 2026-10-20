import { test, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLiveIndexer } from '../src/live.mts';
import type { RecoveryPage } from '../src/recovery.mts';
const source: RecoveryPage = JSON.parse(await readFile(new URL('fixtures/subscription-recovery.json', import.meta.url), 'utf8'));
const comparison = JSON.parse(await readFile(new URL('fixtures/disconnected-transfers.json', import.meta.url), 'utf8'));
const start = source.query.fromBlock, end = source.query.toBlock;
const log = source.reply.data.logs[0]!;
const identity = (item: typeof log) => `${item.transactionHash.toLowerCase()}:${item.logIndex}`;
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'chog-live-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function harness(directory: string) {
  let height = end, fail = false, calls = 0;
  return {
    height(value: number) { height = value; }, fail(value: boolean) { fail = value; }, calls: () => calls,
    open: () => openLiveIndexer({ directory, fromBlock: start, getHeight: async () => height,
      fetchPage: async (fromBlock, toBlock) => {
        calls++;
        if (fail) throw new Error('offline');
        return { fetchedAt: source.fetchedAt, query: { ...source.query, fromBlock, toBlock }, reply: {
          nextBlock: toBlock, data: { logs: source.reply.data.logs.filter(item => item.blockNumber >= fromBlock && item.blockNumber < toBlock) },
        } };
      },
    }),
  };
}
test('live duplicates and disconnect gaps yield exactly ten canonical transfers after restart', () => temporary(async directory => {
  const h = harness(directory);
  h.height(source.reply.data.logs[6]!.blockNumber);
  const first = await h.open();
  try {
    for (const item of source.reply.data.logs.filter(item => !comparison.missing.includes(identity(item)))) {
      await first.observe(item); await first.observe(item);
    }
    expect((await first.sync()).transfers).toBe(6);
  } finally { await first.close(); }
  h.height(end);
  const resumed = await h.open();
  try {
    const result = await resumed.sync();
    expect(result.status).toBe('PASS');
    expect(result.transfers).toBe(10);
    expect(result.recovered.sort()).toEqual([...comparison.missing].sort());
    expect(new Set(result.logs.map(identity)).size).toBe(10);
    const calls = h.calls();
    expect((await resumed.sync()).fetchedPages).toBe(0);
    expect(h.calls()).toBe(calls);
  } finally { await resumed.close(); }
}));
test('history fetch failure retries without losing observations or skipping blocks', () => temporary(async directory => {
  const h = harness(directory), indexer = await h.open();
  try {
    await indexer.observe(log);
    h.fail(true);
    await expect(indexer.sync()).rejects.toThrow('offline');
    h.fail(false);
    const result = await indexer.sync();
    expect(result.transfers).toBe(10);
    expect(result.recovered).not.toContain(identity(log));
  } finally { await indexer.close(); }
}));
test('live messages ahead of history remain pending until the history catches up', () => temporary(async directory => {
  const h = harness(directory), indexer = await h.open();
  try {
    h.height(log.blockNumber);
    await indexer.observe(log);
    const pending = await indexer.sync();
    expect(pending.logs).toEqual([]);
    expect(pending.pending).toEqual([identity(log)]);
    h.height(end);
    expect((await indexer.sync()).pending).toEqual([]);
  } finally { await indexer.close(); }
}));
test('a removed log invalidates the snapshot immediately and survives restart', () => temporary(async directory => {
  const h = harness(directory), first = await h.open();
  try {
    await first.sync();
    await first.observe({ ...log, removed: true });
    expect(JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8')).status).toBe('REVIEW');
    h.fail(true);
  } finally { await first.close(); }
  const resumed = await h.open();
  try {
    const result = await resumed.sync();
    expect(result.status).toBe('REVIEW');
    expect(result.removed).toEqual([identity(log)]);
  } finally { await resumed.close(); }
}));
test('contradictory live and historical content requires review', () => temporary(async directory => {
  const h = harness(directory), indexer = await h.open();
  try {
    await indexer.observe({ ...log, blockNumber: log.blockNumber + 1 });
    expect((await indexer.sync()).conflicting).toEqual([identity(log)]);
  } finally { await indexer.close(); }
}));
test('unmatched live transfer inside covered range requires review', () => temporary(async directory => {
  const h = harness(directory), indexer = await h.open();
  try {
    await indexer.observe({ ...log, transactionHash: '0x' + 'a'.repeat(64) });
    expect((await indexer.sync()).status).toBe('REVIEW');
  } finally { await indexer.close(); }
}));
test('concurrent catch-up requests serialize and do not fetch twice', () => temporary(async directory => {
  const h = harness(directory), indexer = await h.open();
  try {
    const [first, second] = await Promise.all([indexer.sync(), indexer.sync()]);
    expect(first.transfers).toBe(10); expect(second.fetchedPages).toBe(0); expect(h.calls()).toBe(1);
    await expect(h.open()).rejects.toMatchObject({ code: 'EEXIST' });
  } finally { await indexer.close(); }
}));
test('incompatible restart configuration fails without leaving its lock', () => temporary(async directory => {
  const h = harness(directory), first = await h.open(); await first.close();
  await expect(openLiveIndexer({ directory, fromBlock: start + 1, getHeight: async () => end, fetchPage: async () => source })).rejects.toThrow('INDEXER_STATE');
  const resumed = await h.open(); await resumed.close();
  await expect(resumed.sync()).rejects.toThrow('INDEXER_CLOSED');
}));
