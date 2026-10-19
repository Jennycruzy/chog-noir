import {test,expect,beforeEach,afterEach} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {Publisher,dailyDraft} from '../src/publish.mts';
import {CaseVault} from '../src/vault.mts';
import {draft} from '../../game/test/fixture.mts';
import {chainCaseId,type CaseChain,type ChainReceipt} from '../../chain/src/casebook.mts';
import type {Hex,Address} from 'viem';
let directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'chog-publish-'));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
const address=('0x'+'12'.repeat(20)) as Address,zero=('0x'+'0'.repeat(64)) as Hex;
function mockChain(){
 let hash:Hex=zero,closed=false,opensAt=0,closesAt=0;let fail=false;
 const counts={open:0,close:0,cast:0};
 const receipt=(kind:string):ChainReceipt=>({hash:chainCaseId(kind),blockNumber:'100',blockHash:chainCaseId('block'),timestamp:100,status:'success',chainId:143,address});
 const chain:CaseChain={address,async inspect(){return {hash,closed,opensAt,closesAt};},async open(draft,open,close){if(fail)throw new Error('offline');counts.open++;hash=draft.public.answerHash as Hex;opensAt=open;closesAt=close;return receipt('open');},async close(){closed=true;counts.close++;return receipt('close');},async cast(){counts.cast++;return receipt('cast');}};
 return {chain,counts,setFail(value:boolean){fail=value;}};
}
test('daily wrapping gets a new salt and case-bound commitment without changing the archive key',()=>{
 const wrapped=dailyDraft(draft,'2026-10-18');expect(wrapped.public.id).toBe('2026-10-18-main');expect(wrapped.private.salt).not.toBe(draft.private.salt);expect(wrapped.public.answerHash).not.toBe(draft.public.answerHash);expect(wrapped.private.key).toEqual(draft.private.key);
});
test('vault contents are encrypted and authenticated against the case identifier',async()=>{
 const vault=new CaseVault(directory,randomBytes(32));await vault.save(draft);
 const text=await readFile(join(directory,(await readdir(directory))[0]!),'utf8');expect(text).not.toContain(draft.private.salt);expect(text).not.toContain('"key"');
 expect(await vault.load(draft.public.id)).toEqual(draft);
 await expect(new CaseVault(directory,randomBytes(32)).load(draft.public.id)).rejects.toThrow();
});
test('failed chain submission never publishes and retry retains the original prepared salt',async()=>{
 const vault=new CaseVault(join(directory,'vault'),randomBytes(32)),mock=mockChain();mock.setFail(true);
 let now=150_000;const publisher=new Publisher(join(directory,'publications'),vault,mock.chain,()=>now);
 await publisher.prepare(draft,'2026-10-18','FRESH',200,400);
 const first=await vault.load('2026-10-18-main');
 await expect(publisher.publish(first.public.id)).rejects.toThrow('offline');expect((await publisher.read(first.public.id))!.status).toBe('PREPARED');
 await publisher.prepare(draft,'2026-10-18','FRESH',200,400);expect((await vault.load(first.public.id)).private.salt).toBe(first.private.salt);
 mock.setFail(false);expect((await publisher.publish(first.public.id)).status).toBe('COMMITTED');
 now=200_000;expect((await publisher.publish(first.public.id)).status).toBe('PUBLISHED');
 const count=mock.counts.open;await publisher.publish(first.public.id);expect(mock.counts.open).toBe(count);
});
test('close is time-gated, confirms the chain and records cast after the reveal',async()=>{
 let now=200_000;const mock=mockChain(),vault=new CaseVault(join(directory,'vault'),randomBytes(32));
 const publisher=new Publisher(join(directory,'publications'),vault,mock.chain,()=>now);
 const prepared=await publisher.prepare(draft,'2026-10-18','COLD_FALLBACK',200,400);await publisher.publish(prepared.id);
 await expect(publisher.close(prepared.id)).rejects.toThrow('stay private');expect(mock.counts.cast).toBe(0);
 now=400_000;expect((await publisher.close(prepared.id)).status).toBe('COMPLETE');
 await publisher.close(prepared.id);expect(mock.counts.cast).toBe(1);expect(mock.counts.close).toBe(1);
});
test('conflicting publication windows fail instead of overwriting a prepared commitment',async()=>{
 const publisher=new Publisher(join(directory,'pub'),new CaseVault(join(directory,'vault'),randomBytes(32)),mockChain().chain,()=>100_000);
 await publisher.prepare(draft,'2026-10-18','FRESH',200,400);
 await expect(publisher.prepare(draft,'2026-10-18','FRESH',250,400)).rejects.toThrow('differs');
});
