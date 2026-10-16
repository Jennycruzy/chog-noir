import { ZERO, type Transfer } from './chain.mts';
export interface Ownership { tokenId: number; owner: string; arrival: Transfer; arrivedAt: string; departure: Transfer | null; departedAt: string | null; heldSeconds: number | null }
export function buildOwnership(transfers: readonly Transfer[], blockTimes: ReadonlyMap<number, number>): Ownership[] {
  const current = new Map<number, Ownership>();
  const everMinted = new Set<number>();
  const seen = new Set<string>();
  const records: Ownership[] = [];
  for (const transfer of [...transfers].sort((a,b) => a.block-b.block || a.logIndex-b.logIndex)) {
    const key = `${transfer.tx}:${transfer.logIndex}`;
    if (seen.has(key)) throw new Error('DATA_OWNER_DUPLICATE: Repeated transfer');
    seen.add(key);
    const timestamp = blockTimes.get(transfer.block);
    if (timestamp === undefined || !Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('DATA_OWNER_TIME: Missing or invalid source block time');
    const at = new Date(timestamp * 1000).toISOString();
    const previous = current.get(transfer.tokenId);
    if (transfer.from === ZERO) {
      if (everMinted.has(transfer.tokenId)) throw new Error('DATA_OWNER_MINT: Duplicate mint');
      everMinted.add(transfer.tokenId);
    } else {
      if (!previous || previous.owner !== transfer.from) throw new Error(`DATA_OWNER_GAP: Broken ownership at ${key}`);
      if (Date.parse(previous.arrivedAt) > timestamp*1000) throw new Error('DATA_OWNER_TIME: Block times move backwards');
      if (transfer.from === transfer.to) continue;
      previous.departure = transfer;
      previous.departedAt = at;
      previous.heldSeconds = timestamp - Date.parse(previous.arrivedAt)/1000;
    }
    current.delete(transfer.tokenId);
    if (transfer.to !== ZERO) {
      const next: Ownership = { tokenId: transfer.tokenId, owner: transfer.to, arrival: transfer, arrivedAt: at, departure: null, departedAt: null, heldSeconds: null };
      records.push(next);
      current.set(transfer.tokenId, next);
    }
  }
  return records;
}
