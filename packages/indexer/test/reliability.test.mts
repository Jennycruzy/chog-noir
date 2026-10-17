import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { compareReliability } from '../src/reliability.mts';
import type { RecoveryPage } from '../src/recovery.mts';
const page: RecoveryPage = JSON.parse(await readFile(new URL('fixtures/subscription-recovery.json', import.meta.url), 'utf8'));
const input = { complete: true, startedAt: '2026-10-16T10:00:00Z', finishedAt: '2026-10-16T16:00:00Z', durationSeconds: 21600,
  fromBlock: page.query.fromBlock, toBlockExclusive: page.query.toBlock, status: 'PASS', stored: page.reply.data.logs, reference: page.reply.data.logs };
test('complete six-hour recovered history matches a fresh full-range query', () => { expect(compareReliability(input).status).toBe('PASS'); });
test('short run cannot claim six-hour completion', () => { expect(compareReliability({ ...input, finishedAt: '2026-10-16T10:01:00Z' }).status).toBe('INTERRUPTED'); });
test('signal interruption cannot pass even after six hours', () => { expect(compareReliability({ ...input, complete: false }).status).toBe('INTERRUPTED'); });
test('missing transfers fail the completed comparison', () => { const report = compareReliability({ ...input, stored: input.stored.slice(4) }); expect(report.status).toBe('FAIL'); expect(report.missing).toHaveLength(4); });
test('canonical duplicates fail even if all identities match', () => { expect(compareReliability({ ...input, stored: [...input.stored, input.stored[0]!] }).status).toBe('FAIL'); });
test('same identities with altered transfer content fail', () => {
  const stored = input.stored.map((log, index) => index ? log : { ...log, blockNumber: log.blockNumber + 1 });
  expect(compareReliability({ ...input, stored }).conflicting).toHaveLength(1);
});
test('an unresolved removal or discrepancy cannot pass', () => { expect(compareReliability({ ...input, status: 'REVIEW' }).status).toBe('FAIL'); });
test('zero observed activity is inconclusive rather than reliability evidence', () => { expect(compareReliability({ ...input, stored: [], reference: [] }).status).toBe('INCONCLUSIVE'); });
test('out-of-window reference log is rejected', () => { expect(() => compareReliability({ ...input, toBlockExclusive: input.fromBlock + 1 })).toThrow('RELIABILITY_RANGE'); });
