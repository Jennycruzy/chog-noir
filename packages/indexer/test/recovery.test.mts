import { test, expect } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverTransfers, type RecoveryPage } from '../src/recovery.mts';
import type { ChainLog } from '../../core/src/chain.mts';
const fixture = JSON.parse(await readFile(new URL('../../core/test/history/token-650.json', import.meta.url), 'utf8'));
const log: ChainLog = fixture.logs[0];
const start = log.blockNumber, end = start + 2;
function page(fromBlock = start, toBlock = end, nextBlock = end, logs = [log]): RecoveryPage {
  return { fetchedAt: '2026-10-16T00:00:00Z', query: { fromBlock, toBlock }, reply: { nextBlock, data: { logs } } };
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'chog-recovery-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
test('saves complete real transfer records and a second run fetches nothing', () => temporary(async directory => {
  const result = await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page() });
  expect(result.logs).toEqual([log]);
  const again = await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => { throw new Error('must not fetch'); } });
  expect(again.fetchedPages).toBe(0);
  expect(again.logs).toEqual(result.logs);
}));
test('a later-page failure resumes from the last durable checkpoint', () => temporary(async directory => {
  await expect(recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async from => {
    if (from === start) return page(start, end, start + 1);
    throw new Error('disconnected');
  } })).rejects.toThrow('disconnected');
  const resumed = await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async from => {
    expect(from).toBe(start + 1); return page(from, end, end, []);
  } });
  expect(resumed.logs).toEqual([log]);
  expect(resumed.pages).toBe(2);
}));
test('a page left before checkpoint commit is replaced on restart', () => temporary(async directory => {
  await writeFile(join(directory, 'page-0.json'), 'incomplete');
  expect((await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page() })).transfers).toBe(1);
}));
test.each([
  ['non-advancing page', () => page(start, end, start)],
  ['page beyond requested range', () => page(start, end, end + 1)],
  ['wrong request', () => page(start + 1)],
  ['incomplete log', () => page(start, end, end, [{ ...log, topics: [] }])],
  ['foreign contract', () => page(start, end, end, [{ ...log, address: '0x' + '1'.repeat(40) }])],
  ['removed log', () => page(start, end, end, [{ ...log, removed: true }])],
  ['out-of-range log', () => page(start, end, end, [{ ...log, blockNumber: end }])],
] as const)('rejects %s without checkpointing', (_, makePage) => temporary(async directory => {
  await expect(recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => makePage() })).rejects.toThrow();
  await expect(readFile(join(directory, 'checkpoint.json'))).rejects.toMatchObject({ code: 'ENOENT' });
}));
test('deduplicates identical logs and rejects changed identities', () => temporary(async directory => {
  expect((await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page(start, end, end, [log, log]) })).transfers).toBe(1);
  await expect(recoverTransfers({ directory: join(directory, 'conflict'), fromBlock: start, toBlock: end,
    fetchPage: async () => page(start, end, end, [log, { ...log, blockNumber: start + 1 }]) })).rejects.toThrow('RECOVERY_CONFLICT');
}));
test('detects missing durable source pages on restart', () => temporary(async directory => {
  await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page() });
  await rm(join(directory, 'page-0.json'));
  await expect(recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page() })).rejects.toThrow();
}));
test('prevents concurrent writers', () => temporary(async directory => {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const first = recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => { entered(); await wait; return page(); } });
  await ready;
  try { await expect(recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page() })).rejects.toMatchObject({ code: 'RECOVERY_BUSY' }); }
  finally { release(); await first; }
}));
test('a writer that died holding the lock does not block the next recovery', () => temporary(async directory => {
  // flock is held by a separate process that is then killed, as when a service is stopped mid-run.
  const { spawn } = await import('node:child_process');
  await mkdir(directory, { recursive: true });
  const holder = spawn('flock', ['-x', join(directory, 'writer.lock'), 'sleep', '30'], { stdio: 'ignore', detached: true });
  await new Promise(resolve => setTimeout(resolve, 300));
  await expect(recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page() })).rejects.toMatchObject({ code: 'RECOVERY_BUSY' });
  const exited = new Promise(resolve => holder.once('exit', resolve));
  process.kill(-holder.pid!, 'SIGKILL'); await exited; await new Promise(resolve => setTimeout(resolve, 100));
  expect((await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page() })).transfers).toBe(1);
}));
test('recovers all four transfers missed in the real six-hour run and resumes without refetching', () => temporary(async directory => {
  const source: RecoveryPage = JSON.parse(await readFile(new URL('fixtures/subscription-recovery.json', import.meta.url), 'utf8'));
  const comparison = JSON.parse(await readFile(new URL('fixtures/disconnected-transfers.json', import.meta.url), 'utf8'));
  const options = { directory, fromBlock: source.query.fromBlock, toBlock: source.query.toBlock };
  const recovered = await recoverTransfers({ ...options, fetchPage: async () => source });
  expect(recovered.transfers).toBe(10);
  const identities = new Set(recovered.logs.map(log => `${log.transactionHash.toLowerCase()}:${log.logIndex}`));
  expect(comparison.missing).toHaveLength(4);
  for (const key of comparison.missing) expect(identities.has(key)).toBe(true);
  const resumed = await recoverTransfers({ ...options, fetchPage: async () => { throw new Error('must not refetch'); } });
  expect(resumed.fetchedPages).toBe(0);
  expect(resumed.logs).toEqual(recovered.logs);
}));
test('a resume reads the compact checkpoint instead of every saved page, and upgrades an older checkpoint once', () => temporary(async directory => {
  const first = await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => page() });
  // Saved pages remain as evidence, but the next resume does not parse them again.
  for (const file of (await readdir(directory)).filter(name => name.startsWith('page-'))) await writeFile(join(directory, file), 'not parsed on resume');
  const resumed = await recoverTransfers({ directory, fromBlock: start, toBlock: end, fetchPage: async () => { throw new Error('must not fetch'); } });
  expect(resumed.logs).toEqual(first.logs); expect(resumed.fetchedPages).toBe(0);
  const legacy = join(directory, 'legacy'); await recoverTransfers({ directory: legacy, fromBlock: start, toBlock: end, fetchPage: async () => page() });
  const saved = JSON.parse(await readFile(join(legacy, 'checkpoint.json'), 'utf8')); delete saved.logs; saved.version = 1; await writeFile(join(legacy, 'checkpoint.json'), JSON.stringify(saved));
  expect((await recoverTransfers({ directory: legacy, fromBlock: start, toBlock: end, fetchPage: async () => { throw new Error('must not fetch'); } })).logs).toEqual(first.logs);
  expect(JSON.parse(await readFile(join(legacy, 'checkpoint.json'), 'utf8')).version).toBe(2);
  saved.version = 2; saved.logs = []; await writeFile(join(legacy, 'checkpoint.json'), JSON.stringify(saved));
  await expect(recoverTransfers({ directory: legacy, fromBlock: start, toBlock: end, fetchPage: async () => page() })).rejects.toThrow('RECOVERY_CHECKPOINT');
}));
