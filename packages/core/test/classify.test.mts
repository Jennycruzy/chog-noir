import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { classifyTransaction } from '../src/classify.mts';
import { CHOG, SEAPORT, ORDER_TOPIC, decodeTransfer, type ChainLog } from '../src/chain.mts';
import { required, type StoredFixture, type RpcTransaction, type RpcReceipt } from '../../../scripts/data-types.mts';
async function fixture(hash: string) {
  const stored = JSON.parse(await readFile(new URL(`fixtures/${hash}.json`,import.meta.url),'utf8')) as StoredFixture;
  const raw = required(stored.replies.find(reply=>reply.id===0)?.result,'Missing transaction') as RpcTransaction;
  const receipt = required(stored.replies.find(reply=>reply.id===1)?.result,'Missing receipt') as RpcReceipt;
  return { tx: {...raw,blockNumber:Number(BigInt(raw.blockNumber))}, logs:receipt.logs.map(log=>({...log,blockNumber:Number(BigInt(log.blockNumber)),logIndex:Number(BigInt(log.logIndex))})) };
}
const offer='0x8d144408fae4b78a5d7a42efa85ddf0ec30be2de67e8c05cff2df4a6a5830e3c';
const native='0x89c8e99142bd0c0419d83b79c316c33996a25b497e35c0af7f5958eb33a9a134';
const expected = [
  [offer,1473,'SALE','offer_accepted','4422000000000000000000'],
  ['0xdecaddd8a4f17fd6b57cbce9d504cd5b9feb86a64ffd6ef1e1f0632af077495f',445,'SALE','offer_accepted','4900000000000000000000'],
  [native,650,'SALE','listing_bought','5200000000000000000000'],
  ['0x0b9b19c489b4f816d0fb9d30029be8743d5cb9d7c870e596713a6cd796394049',1864,'SALE','listing_bought','6099999900000000000000'],
  ['0xb99816a46217e53c5da521b31ce721fd6f751e16cc12bcf3bcc301ab9f07d2bf',1864,'UNCLASSIFIED',undefined,undefined],
  ['0x3d4c6e6eb9db225e5d493a55f2fa23e2c42b8fc4a0fdec4ee37182a7a660d048',560,'BULK_MOVE',undefined,undefined],
  ['0x6568b48b64c94150fcd68cb6e9be67e2ec0121e22894d852d63e93fe255837e8',1021,'UNCLASSIFIED',undefined,undefined],
  ['0x968b2636f5b1ac314fa2ffc657025683ab2cc6c35dd7e8a2d0ea23f0dc240bf2',1021,'UNCLASSIFIED',undefined,undefined],
  ['0xe3fa036d75423405a28f8f79664906e1623840f7d4507ddd5f2991be88717824',382,'PLAIN_TRANSFER',undefined,undefined],
  ['0xfecca011a4b451d0e55850e29ad324e654a7d547a9a7bdccfe22d8d65259c9b0',1471,'SALE','listing_bought','6324989900000000000000'],
  ['0x31b744745421895718883b39f866c3ba056c4866996cec4475beeee706ea0430',28,'SALE','listing_bought','5500000000000000000000'],
] as const;
for (const [hash,tokenId,classification,route,gross] of expected) test(`real transaction ${hash}: token ${tokenId}`,async()=>{
  const {tx,logs}=await fixture(hash);
  const event=classifyTransaction(tx,logs).find(event=>event.tokenId===tokenId);
  expect(event?.class).toBe(classification); expect(event?.route).toBe(route); expect(event?.price?.grossWei).toBe(gross);
  expect(event?.evidence.tx).toBe(hash);
});
test('fake-token fixture cannot become a Chog event',async()=>{const {tx,logs}=await fixture('0xb745cd30bcbdf8131b02b89f2b72b7d78bcc024b048fe0a26a3d683f70b81f81');expect(classifyTransaction(tx,logs)).toEqual([]);});
test('matched offer counts payment once and preserves seller proceeds',async()=>{const {tx,logs}=await fixture(offer);expect(classifyTransaction(tx,logs)[0]?.price).toEqual({asset:'WMON',status:'EXACT',grossWei:'4422000000000000000000',sellerProceedsWei:'4377780000000000000000',feesWei:'44220000000000000000'});});
test('batch has four separately priced sales',async()=>{const {tx,logs}=await fixture(expected[3][0]);expect(classifyTransaction(tx,logs).filter(event=>event.price?.status==='EXACT')).toHaveLength(4);});
// Deliberately damaged copies exercise failure paths; none is published as chain data.
test('damaged copy with duplicate log fails',async()=>{const {tx,logs}=await fixture(native);expect(()=>classifyTransaction(tx,[...logs,required(logs[0],'Log missing')])).toThrow('DATA_LOG_SOURCE');});
test('damaged copy with removed log fails',async()=>{const {tx,logs}=await fixture(native);expect(()=>classifyTransaction(tx,logs.map(log=>({...log,removed:true})))).toThrow('DATA_LOG_SOURCE');});
test('damaged copy from wrong block fails',async()=>{const {tx,logs}=await fixture(native);expect(()=>classifyTransaction({...tx,blockNumber:tx.blockNumber+1},logs)).toThrow('DATA_LOG_SOURCE');});
test('damaged order data fails instead of becoming a move',async()=>{const {tx,logs}=await fixture(native);expect(()=>classifyTransaction(tx,logs.map(log=>log.topics[0]===ORDER_TOPIC?{...log,data:'0x'}:log))).toThrow();});
test('missing fulfilled order is unknown, never proof of no payment',async()=>{const {tx,logs}=await fixture(native);const result=classifyTransaction(tx,logs.filter(log=>log.topics[0]!==ORDER_TOPIC));expect(result[0]?.class).toBe('UNCLASSIFIED');expect(result[0]?.price).toBeUndefined();});
test('lookalike order emitter is ignored',async()=>{const {tx,logs}=await fixture(native);const result=classifyTransaction(tx,logs.map(log=>log.address.toLowerCase()===SEAPORT?{...log,address:CHOG}:log));expect(result[0]?.class).toBe('UNCLASSIFIED');});
test('transfer missing token topic fails',async()=>{const {logs}=await fixture(native);const log=required(logs.find(log=>log.address.toLowerCase()===CHOG),'Transfer missing');expect(()=>decodeTransfer({...log,topics:log.topics.slice(0,3)})).toThrow('DATA_TRANSFER');});
test('output does not depend on receipt log array order',async()=>{const {tx,logs}=await fixture(offer);expect(classifyTransaction(tx,[...logs].reverse())).toEqual(classifyTransaction(tx,logs));});
test('matched orders include fees from both halves without double counting',async()=>{
  const stored=JSON.parse(await readFile(new URL('history/matched-fees.json',import.meta.url),'utf8')) as {transaction:Parameters<typeof classifyTransaction>[0];logs:ChainLog[]};
  const result=classifyTransaction(stored.transaction,stored.logs).find(event=>event.tokenId===344);
  expect(result?.class).toBe('SALE');
  expect(result?.price).toEqual({asset:'WMON',status:'EXACT',grossWei:'6300000000000000000000',sellerProceedsWei:'5922000000000000000000',feesWei:'378000000000000000000'});
});
