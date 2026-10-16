import {storeEscrowDeals} from '../escrow-deals.mts';
import {EscrowIndex,type EscrowInput} from '../../core/src/escrow.mts';
import {CHOG,TRANSFER_TOPIC,decodeTransfer,type ChainLog} from '../../core/src/chain.mts';
import type {StoredTrace} from '../../core/src/native-payments.mts';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, beforeEach, afterEach, test, expect } from 'vitest';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { migrate } from '../migrate.mts';
import { required, type StoredFixture, type RpcTransaction, type RpcReceipt, type StoredMetadata, type HistoryBlock } from '../../../scripts/data-types.mts';

const database = new PGlite();
const escrowFixture=JSON.parse(await readFile(new URL('../../core/test/history/escrow.json',import.meta.url),'utf8')) as {input:EscrowInput;traces:Record<string,StoredTrace>;logs:ChainLog[]};
const escrowIndex=new EscrowIndex(escrowFixture.input,escrowFixture.logs.filter(log=>log.address.toLowerCase()===CHOG&&log.topics[0]===TRANSFER_TOPIC).map(decodeTransfer),{traces:escrowFixture.traces,logs:escrowFixture.logs});
const realDeal=escrowIndex.deals.find(deal=>deal.id==='35')!;
const escrowMetadata=JSON.parse(await readFile(new URL('fixtures/token-1021.json',import.meta.url),'utf8')) as StoredMetadata;
const fixture = JSON.parse(await readFile(new URL('../../core/test/fixtures/0x89c8e99142bd0c0419d83b79c316c33996a25b497e35c0af7f5958eb33a9a134.json', import.meta.url), 'utf8')) as StoredFixture;
const tx = required(fixture.replies.find(row => row.id === 0)?.result, 'Transaction missing') as RpcTransaction;
const receipt = required(fixture.replies.find(row => row.id === 1)?.result, 'Receipt missing') as RpcReceipt;
const log = required(receipt.logs.find(row => row.address.toLowerCase() === '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763' && BigInt(row.topics[3] ?? '0') === 650n), 'Transfer missing');
const metadata = JSON.parse(await readFile(new URL('fixtures/token-650.json', import.meta.url), 'utf8')) as StoredMetadata;
const { block } = JSON.parse(await readFile(new URL('fixtures/block.json', import.meta.url), 'utf8')) as { block: HistoryBlock };
const index = Number(BigInt(log.logIndex));
const at = new Date(block.timestamp * 1000).toISOString();
const sender = `0x${required(log.topics[1], 'Sender missing').slice(-40)}`;
const receiver = `0x${required(log.topics[2], 'Receiver missing').slice(-40)}`;

beforeAll(async () => {
  await migrate(database);
  await database.query('INSERT INTO chain_blocks VALUES ($1,$2,$3,$4)', [block.number, block.hash, at, fixture.fetchedAt]);
  await database.query('INSERT INTO chain_transactions(hash,block_number,signer,destination,input,value_wei,receipt,fetched_at,source_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tx.hash, block.number, tx.from, tx.to, tx.input, BigInt(tx.value).toString(), receipt, fixture.fetchedAt, {provider: 'RPC', fetchedAt: fixture.fetchedAt}]);
  await database.query('INSERT INTO chogs VALUES ($1,$2,$3,$4,$5,$6)', [650, metadata.uri, metadata.metadata.name, metadata.metadata.image, metadata.metadata, metadata.fetchedAt]);
  await database.query('INSERT INTO chogs VALUES ($1,$2,$3,$4,$5,$6)', [1021,escrowMetadata.uri,escrowMetadata.metadata.name,escrowMetadata.metadata.image,escrowMetadata.metadata,escrowMetadata.fetchedAt]);
  await database.query('INSERT INTO transfers VALUES ($1,$2,$3,$4,$5,$6)', [tx.hash, index, 650, sender, receiver, log]);
}, 90000);
afterAll(async () => { await database.close(); });
beforeEach(async () => { await database.exec('BEGIN'); });
afterEach(async () => { await database.exec('ROLLBACK'); });

async function classify(classification = 'SALE') {
  await database.query('INSERT INTO events_classified VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [tx.hash, index, classification, 'R2', 'Stored fulfilled order', { tx: tx.hash }, 1, fixture.fetchedAt]);
}
async function sale(gross: string | null = '5200000000000000000000', net: string | null = '5148000000000000000000', fees: string | null = '52000000000000000000', status = 'EXACT') {
  return database.query('INSERT INTO sales VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tx.hash, index, 'listing_bought', 'MON', gross, net, fees, status, { tx: tx.hash, logIndex: index }]);
}

test('real receipt, metadata and transfer stay linked', async () => {
  const result = await database.query<{ metadata_name: string; hash: string }>('SELECT c.metadata_name, t.hash FROM transfers x JOIN chogs c ON c.token_id=x.token_id JOIN chain_transactions t ON t.hash=x.tx_hash');
  expect(result.rows).toEqual([{ metadata_name: metadata.metadata.name, hash: tx.hash }]);
});
test('real native payment retains every wei', async () => {
  await classify(); await sale();
  const result = await database.query<{ gross: string }>('SELECT gross_wei::text AS gross FROM sales');
  expect(result.rows[0]?.gross).toBe('5200000000000000000000');
});
test('missing exact payment fails', async () => { await classify(); await expect(sale(null)).rejects.toThrow(); });
test('fractional wei is rejected without rounding', async () => { await classify(); await expect(sale('5200000000000000000000.1')).rejects.toThrow(); });
test('fee mismatch fails', async () => { await classify(); await expect(sale('5200000000000000000001')).rejects.toThrow(); });
test('negative fees fail', async () => { await classify(); await expect(sale('5147999999999999999999', '5148000000000000000000', '-1')).rejects.toThrow(); });
test('unclassified movement cannot become a sale', async () => { await classify('UNCLASSIFIED'); await expect(sale()).rejects.toThrow('DATA_SALE_CLASS'); });
test('sale cannot silently become a plain transfer', async () => {
  await classify(); await sale();
  await expect(database.query("UPDATE events_classified SET classification='PLAIN_TRANSFER'")).rejects.toThrow('DATA_SALE_CLASS');
});
test('bundle keeps individual price absent', async () => { await classify(); await sale(null, null, null, 'PRICE_BUNDLE'); });
test('bundle cannot claim an individual price', async () => { await classify(); await expect(sale('5200000000000000000000', null, null, 'PRICE_BUNDLE')).rejects.toThrow(); });
test('duplicate chain log fails', async () => {
  await expect(database.query('INSERT INTO transfers SELECT * FROM transfers')).rejects.toThrow();
});
test('classification requires a stored transfer', async () => {
  await expect(database.query('INSERT INTO events_classified VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [tx.hash, index + 1, 'SALE', 'R2', 'Missing log', {}, 1, fixture.fetchedAt])).rejects.toThrow();
});
test('duplicate ownership record is rejected', async () => {
  await database.query('INSERT INTO owners_timeline(token_id,arrival_tx,arrival_log_index,owner_address,arrived_at) VALUES ($1,$2,$3,$4,$5)', [650, tx.hash, index, receiver, at]);
  await expect(database.query('INSERT INTO owners_timeline SELECT * FROM owners_timeline')).rejects.toThrow();
});
test('owner must match the actual receiving wallet', async () => {
  await expect(database.query('INSERT INTO owners_timeline(token_id,arrival_tx,arrival_log_index,owner_address,arrived_at) VALUES ($1,$2,$3,$4,$5)', [650, tx.hash, index, sender, at])).rejects.toThrow('DATA_OWNER_SOURCE');
});
test('departure cannot precede arrival', async () => {
  await expect(database.query('INSERT INTO owners_timeline VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [650, tx.hash, index, receiver, at, tx.hash, index, '1970-01-01T00:00:00Z'])).rejects.toThrow();
});

test('migration rerun preserves records', async () => {
  // Migration runner owns its transaction, so use a separate database.
  const other = new PGlite();
  try { expect(await migrate(other)).toEqual(['001_chain_records.sql', '002_transaction_sources.sql', '003_escrow_records.sql']); expect(await migrate(other)).toEqual([]); }
  finally { await other.close(); }
}, 90000);
test('edited migration is rejected', async () => {
  const directory = await mkdtemp(`${tmpdir()}/chog-db-`);
  const other = new PGlite();
  const url = pathToFileURL(`${directory}/`);
  try {
    await writeFile(new URL('001_check.sql', url), 'CREATE TABLE original_record (id integer);');
    await migrate(other, url);
    await writeFile(new URL('001_check.sql', url), 'CREATE TABLE changed_record (id integer);');
    await expect(migrate(other, url)).rejects.toThrow('DB_MIGRATION_CHANGED');
  } finally { await other.close(); await rm(directory, { recursive: true, force: true }); }
}, 90000);
test('failed migration rolls back its tables and history', async () => {
  const directory = await mkdtemp(`${tmpdir()}/chog-db-`);
  const other = new PGlite();
  const url = pathToFileURL(`${directory}/`);
  try {
    await writeFile(new URL('001_check.sql', url), 'CREATE TABLE partial_record (id integer); SELECT missing_function();');
    await expect(migrate(other, url)).rejects.toThrow();
    const result = await other.query<{ record: string | null }>("SELECT to_regclass('partial_record')::text AS record");
    expect(result.rows[0]?.record).toBeNull();
    expect((await other.query('SELECT * FROM schema_migrations')).rows).toEqual([]);
  } finally { await other.close(); await rm(directory, { recursive: true, force: true }); }
}, 90000);

test('real escrow lifecycle can advance from creation to payment to collection',async()=>{
  await storeEscrowDeals(database,[{...realDeal,sold:null,collected:null}]);
  await storeEscrowDeals(database,[{...realDeal,collected:null}]);
  await storeEscrowDeals(database,[realDeal]);
  const result=await database.query<{sold:unknown;collected:unknown}>('SELECT sold,collected FROM escrow_deals WHERE deal_id=$1',[realDeal.id]);
  expect(result.rows[0]?.sold).toEqual(realDeal.sold);expect(result.rows[0]?.collected).toEqual(realDeal.collected);
});
test('repeated escrow import preserves one deal and its exact amount',async()=>{
  await storeEscrowDeals(database,[realDeal]);await storeEscrowDeals(database,[realDeal]);
  expect((await database.query('SELECT * FROM escrow_deals')).rows).toHaveLength(1);
});
test('escrow payment cannot be erased by an earlier lifecycle state',async()=>{
  await storeEscrowDeals(database,[realDeal]);
  await expect(storeEscrowDeals(database,[{...realDeal,sold:null,collected:null}])).rejects.toThrow('DB_SOURCE_CONFLICT');
});
test('changed escrow amount conflicts with its saved chain record',async()=>{
  await storeEscrowDeals(database,[realDeal]);
  await expect(storeEscrowDeals(database,[{...realDeal,amountWei:(BigInt(realDeal.amountWei)+1n).toString()}])).rejects.toThrow('DB_SOURCE_CONFLICT');
});
