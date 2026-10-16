import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { migrate } from '../migrate.mts';
import { importHistory, type HistoryInput } from '../import-history.mts';
const source=JSON.parse(await readFile(new URL('../../core/test/history/token-650.json',import.meta.url),'utf8'));
const metadata=JSON.parse(await readFile(new URL('fixtures/token-650.json',import.meta.url),'utf8'));
const input:HistoryInput={sources:source.sources,fetchedAt:source.fetchedAt,toBlockExclusive:source.toBlockExclusive,blocks:source.blocks,transactions:source.transactions,logs:source.relatedLogs,metadata:[{tokenId:650,...metadata}]};
const database=new PGlite();
let original:Awaited<ReturnType<typeof importHistory>>;
beforeAll(async()=>{await migrate(database);original=await importHistory(database,input);},90000);
afterAll(async()=>{await database.close();});
test('imports the complete real token history and sale',async()=>{
  expect(original.transfers).toBe(3);expect(original.sales).toBeGreaterThanOrEqual(1);
  const rows=await database.query<{gross:string;net:string}>("SELECT gross_wei::text AS gross,seller_proceeds_wei::text AS net FROM sales WHERE tx_hash='0x89c8e99142bd0c0419d83b79c316c33996a25b497e35c0af7f5958eb33a9a134'");
  expect(rows.rows).toEqual([{gross:'5200000000000000000000',net:'5148000000000000000000'}]);
});
test('repeating an import does not duplicate records',async()=>{
  expect(await importHistory(database,input)).toEqual(original);
  expect((await database.query<{count:number}>('SELECT count(*)::integer AS count FROM transfers')).rows[0]?.count).toBe(3);
});
test('HyperSync records retain their source without inventing RPC receipts',async()=>{
  const rows=await database.query<{provider:string;receipt:unknown}>("SELECT source_record->>'provider' AS provider,receipt FROM chain_transactions");
  expect(rows.rows.every(row=>row.provider==='HyperSync'&&row.receipt===null)).toBe(true);
});
test('database ownership matches the final real transfer',async()=>{
  const rows=await database.query<{owner_address:string}>('SELECT owner_address FROM owners_timeline WHERE departed_at IS NULL');
  const last=[...source.logs].sort((a:HistoryInput['logs'][number],b:HistoryInput['logs'][number])=>a.blockNumber-b.blockNumber||a.logIndex-b.logIndex).at(-1);
  expect(rows.rows).toEqual([{owner_address:`0x${last.topics[2].slice(-40)}`}]);
});
test('missing metadata fails before writing',async()=>{
  await expect(importHistory(database,{...input,metadata:[]})).rejects.toThrow('DATA_IMPORT');
});
test('duplicate source log fails before writing',async()=>{
  await expect(importHistory(database,{...input,logs:[...input.logs,input.logs[0]!]})).rejects.toThrow('DATA_IMPORT: Duplicate log');
});
test('conflicting block aborts import and preserves the saved source',async()=>{
  const first=input.blocks[0]!;
  const different=input.blocks[1]!;
  await expect(importHistory(database,{...input,blocks:input.blocks.map(block=>block===first?{...block,hash:different.hash}:block)})).rejects.toThrow();
  expect((await database.query<{hash:string}>('SELECT hash FROM chain_blocks WHERE number=$1',[first.number])).rows[0]?.hash).toBe(first.hash);
  expect((await importHistory(database,input)).snapshotHash).toBe(original.snapshotHash);
});
test('metadata conflict rolls back and preserves ownership',async()=>{
  await expect(importHistory(database,{...input,metadata:input.metadata.map(item=>({...item,metadata:{...item.metadata,name:'Damaged test copy'}}))})).rejects.toThrow('DB_SOURCE_CONFLICT');
  expect((await database.query('SELECT * FROM owners_timeline WHERE departed_at IS NULL')).rows).toHaveLength(1);
  expect((await importHistory(database,input)).transfers).toBe(3);
});
test('older snapshot cannot move progress backwards',async()=>{
  const lastBlock=Math.max(...input.transactions.map(tx=>tx.blockNumber));
  const older={...input,blocks:input.blocks.filter(block=>block.number<lastBlock),transactions:input.transactions.filter(tx=>tx.blockNumber<lastBlock),logs:input.logs.filter(log=>log.blockNumber<lastBlock)};
  await expect(importHistory(database,older)).rejects.toThrow('DATA_IMPORT_STALE');
});
test('missing original API provenance fails before writing',async()=>{
  await expect(importHistory(database,{...input,sources:{transactions:{},blocks:{}}})).rejects.toThrow('DATA_SOURCE');
});
test('explicit reclassification rebuilds derived records while preserving chain sources',async()=>{
  await database.exec('BEGIN');
  await database.exec('DELETE FROM sales');
  await database.exec("UPDATE events_classified SET classification='UNCLASSIFIED',rule='R8',reason='Damaged test copy' WHERE classification='SALE'");
  await database.exec('COMMIT');
  await expect(importHistory(database,input)).rejects.toThrow('DB_SOURCE_CONFLICT');
  const rebuilt=await importHistory(database,input,{reclassify:true});
  expect(rebuilt.snapshotHash).toBe(original.snapshotHash);
  expect(rebuilt.sales).toBe(original.sales);
  expect((await database.query('SELECT * FROM chain_transactions')).rows).toHaveLength(input.transactions.length);
});
