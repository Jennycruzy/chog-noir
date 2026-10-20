import { decodeTransfer, type ChainLog } from '../../core/src/chain.mts';
const key = (log: ChainLog) => `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
export function compareReliability(input: {
  complete: boolean; startedAt: string; finishedAt: string; durationSeconds: number;
  fromBlock: number; toBlockExclusive: number; status: string;
  stored: ChainLog[]; reference: ChainLog[];
}) {
  const { complete, startedAt, finishedAt, durationSeconds, fromBlock, toBlockExclusive, status } = input;
  const elapsedSeconds = (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds < 1 ||
      !Number.isSafeInteger(fromBlock) || fromBlock < 0 || !Number.isSafeInteger(toBlockExclusive) || toBlockExclusive <= fromBlock) throw new Error('RELIABILITY_INPUT: Invalid observation window');
  function collect(logs: ChainLog[]) {
    const map = new Map<string, string>();
    let duplicates = 0;
    for (const log of logs) {
      const transfer = decodeTransfer(log);
      if (transfer.block < fromBlock || transfer.block >= toBlockExclusive) throw new Error('RELIABILITY_RANGE: Transfer outside observation window');
      const id = key(log), content = JSON.stringify(transfer);
      if (map.has(id)) duplicates++;
      if (map.has(id) && map.get(id) !== content) throw new Error('RELIABILITY_CONFLICT: Conflicting duplicate');
      map.set(id, content);
    }
    return { map, duplicates };
  }
  const stored = collect(input.stored), reference = collect(input.reference);
  const missing = [...reference.map.keys()].filter(id => !stored.map.has(id));
  const unexpected = [...stored.map.keys()].filter(id => !reference.map.has(id));
  const conflicting = [...stored.map.keys()].filter(id => reference.map.has(id) && stored.map.get(id) !== reference.map.get(id));
  const fullWindow = complete && elapsedSeconds >= durationSeconds;
  return { startedAt, finishedAt, durationSeconds, elapsedSeconds, fromBlock, toBlockExclusive, fullWindow,
    status: !fullWindow ? 'INTERRUPTED' : status !== 'PASS' || stored.duplicates || reference.duplicates || missing.length || unexpected.length || conflicting.length ? 'FAIL' : reference.map.size === 0 ? 'INCONCLUSIVE' : 'PASS',
    expected: reference.map.size, stored: stored.map.size, storedDuplicates: stored.duplicates, referenceDuplicates: reference.duplicates, missing, unexpected, conflicting,
    note: 'Fresh full-range HyperSync comparison against saved incremental ingestion; not an independent-provider or chain-finality check.' };
}
