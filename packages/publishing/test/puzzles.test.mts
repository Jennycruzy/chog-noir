import {test,expect,beforeEach,afterEach} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile,stat,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import type {Hex,Address} from 'viem';
import {PuzzlePublisher} from '../src/puzzles.mts';
import {CaseVault,localVault} from '../src/vault.mts';
import {chainCaseId,type PuzzleChain,type ChainReceipt} from '../../chain/src/casebook.mts';
import {puzzle} from '../../../apps/api/test/fixture.mts';

let directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'chog-publish-'));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
const address=('0x'+'12'.repeat(20)) as Address,zero=('0x'+'0'.repeat(64)) as Hex,{opensAt,closesAt}=puzzle.file;
/** An in-memory CaseBook that behaves like the contract: one lock per case, reveal only after close. */
function chain(){
 let hash:Hex=zero,closed=false,stored={opensAt:0,closesAt:0},fail=false;const counts={open:0,close:0,cast:0,solves:0};
 const receipt=(kind:string):ChainReceipt=>({hash:chainCaseId(kind),blockNumber:'100',blockHash:chainCaseId('block'),timestamp:100,status:'success',chainId:143,address});
 const value:PuzzleChain={address,async inspect(){return {hash,closed,...stored};},
  async open(item){if(fail)throw new Error('offline');counts.open++;hash=item.answerHash as Hex;stored={opensAt:item.file.opensAt,closesAt:item.file.closesAt};return receipt('open');},
  async close(){closed=true;counts.close++;return receipt('close');},async cast(){counts.cast++;return receipt('cast');},async solves(_,chunk){counts.solves++;return receipt('solves-'+chunk);}};
 return {value,counts,setFail(next:boolean){fail=next;}};
}
test('a failed lock never publishes, and a retry keeps the sealed key and salt',async()=>{
 const vault=new CaseVault(join(directory,'vault'),randomBytes(32)),mock=chain();mock.setFail(true);
 let now=(opensAt-1800)*1000;const publisher=new PuzzlePublisher(join(directory,'publications'),vault,mock.value,()=>now);
 await publisher.prepare(puzzle,'FRESH');
 await expect(publisher.publish(puzzle.file.day)).rejects.toThrow('offline');expect((await publisher.read(puzzle.file.day))!.status).toBe('PREPARED');
 await publisher.prepare(puzzle,'FRESH');expect((await vault.open<typeof puzzle>(puzzle.file.id)).key.salt).toBe(puzzle.key.salt);
 mock.setFail(false);expect((await publisher.publish(puzzle.file.day)).status).toBe('COMMITTED');
 now=(opensAt+60)*1000;expect((await publisher.publish(puzzle.file.day)).status).toBe('PUBLISHED');
 const count=mock.counts.open;await publisher.publish(puzzle.file.day);expect(mock.counts.open).toBe(count);
 const text=await readFile(join(directory,'vault',(await readdir(join(directory,'vault')))[0]!),'utf8');expect(text).not.toContain(puzzle.key.salt);
});
test('the reveal waits for close, and the cast and results are recorded once',async()=>{
 let now=(opensAt+60)*1000;const mock=chain(),publisher=new PuzzlePublisher(join(directory,'publications'),new CaseVault(join(directory,'vault'),randomBytes(32)),mock.value,()=>now);
 await publisher.prepare(puzzle,'COLD_FALLBACK');await publisher.publish(puzzle.file.day);
 await expect(publisher.close(puzzle.file.day)).rejects.toThrow('stay private');expect(mock.counts.close).toBe(0);
 await expect(publisher.recordSolves(puzzle.file.day,[])).rejects.toThrow('PUBLISH_ORDER');
 now=(closesAt+60)*1000;expect((await publisher.close(puzzle.file.day)).status).toBe('CAST_RECORDED');
 await publisher.close(puzzle.file.day);expect(mock.counts.cast).toBe(1);expect(mock.counts.close).toBe(1);
 const rows=Array.from({length:201},(_,index)=>({tokenId:index+1,solved:true,perfect:false,caught:['A' as const],grade:'B' as const}));
 const done=await publisher.recordSolves(puzzle.file.day,rows);expect(done.solveCount).toBe(201);expect(mock.counts.solves).toBe(2);
 await publisher.recordSolves(puzzle.file.day,rows);expect(mock.counts.solves).toBe(2);
});
test('a different key for a prepared day is refused instead of overwriting the lock',async()=>{
 const publisher=new PuzzlePublisher(join(directory,'pub'),new CaseVault(join(directory,'vault'),randomBytes(32)),chain().value,()=>(opensAt-600)*1000);
 await publisher.prepare(puzzle,'FRESH');
 const other=structuredClone(puzzle);other.answerHash='0x'+'ab'.repeat(32);
 await expect(publisher.prepare(other,'FRESH')).rejects.toThrow('PUBLISH_CASE');
});
test('moving a legacy vault master preserves encrypted cases and enforces private file permissions',async()=>{
 const folder=join(directory,'publication-vault'),keyFile=join(directory,'private/vault.key'),key=randomBytes(32);
 await new CaseVault(join(folder,'cases'),key).seal(puzzle.file.id,puzzle);await writeFile(join(folder,'encryption.key'),key,{mode:0o600});
 const moved=await localVault(folder,keyFile);expect(await moved.open(puzzle.file.id)).toEqual(puzzle);expect(await readFile(keyFile)).toEqual(key);expect((await stat(keyFile)).mode&0o777).toBe(0o600);await expect(access(join(folder,'encryption.key'))).rejects.toThrow();
});
test('a missing master key never causes replacement of existing ciphertext',async()=>{
 const folder=join(directory,'missing-master'),keyFile=join(directory,'private/vault.key');await new CaseVault(join(folder,'cases'),randomBytes(32)).seal(puzzle.file.id,puzzle);
 await expect(localVault(folder,keyFile)).rejects.toThrow('VAULT_KEY_MISSING');await expect(access(keyFile)).rejects.toThrow();
 await expect(new CaseVault(join(folder,'cases'),randomBytes(32)).open(puzzle.file.id)).rejects.toThrow();
});
