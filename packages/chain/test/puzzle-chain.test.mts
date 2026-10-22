import {test,expect,beforeAll,afterAll} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createPublicClient,http,encodeDeployData,toHex,type Hex,type Address} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import config from '../../../config/cases.json' with {type:'json'};
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import type {OwnerSnapshot} from '../../auth/src/holders.mts';
import type {Metadata} from '../../cases/src/build.mts';
import {transactionWriter,puzzleChain,monad} from '../src/client.mts';
import {casebookAbi,chainCaseId} from '../src/casebook.mts';
import {verifyPuzzlePublication} from '../src/verify.mts';
import {CaseVault} from '../../publishing/src/vault.mts';
import {PuzzlePublisher} from '../../publishing/src/puzzles.mts';
import {buildDailyPuzzle} from '../../../workers/daily/build.mts';

const binary=process.env.ANVIL_PATH??'/home/ubuntu/.foundry/bin/anvil';
const enabled=existsSync(binary),run=test.skipIf(!enabled);
// A real Sunday case built from the stored Archive 4 records.
const fixture=JSON.parse(readFileSync(new URL('../../cases/test/fixtures/witness-window.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const {snapshot:ownership}=JSON.parse(readFileSync(new URL('../../auth/test/fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot};
const {tokens}=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata}[]};
const {puzzle}=buildDailyPuzzle({day:'2026-10-04',salt:'0x'+'a1'.repeat(32),previous:[],history:fixture.rows,times:new Map(fixture.times),metadata:new Map(tokens.map(row=>[row.tokenId,row.metadata])),ownership,bulkSources:[],rules:config});
const {opensAt,closesAt}=puzzle.file;
let child:ChildProcess|undefined,directory:string,url:string,key:Hex,address:Address,clock=0;
const rpc=async(method:string,params:unknown[])=>{const reply=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(response=>response.json());if(reply.error)throw new Error(method+' failed');return reply.result;};
let publisher:PuzzlePublisher;
beforeAll(async()=>{
 if(!enabled)return;
 directory=await mkdtemp(join(tmpdir(),'chog-puzzle-chain-'));
 const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
 url=`http://127.0.0.1:${port}`;
 // The local chain starts an hour before the case opens, so the real case window can be exercised end to end.
 child=spawn(binary,['--host','127.0.0.1','--port',String(port),'--chain-id','143','--block-time','1','--slots-in-an-epoch','1','--timestamp',String(opensAt-3600),'--silent'],{stdio:'ignore'});
 const client=createPublicClient({chain:monad,transport:http(url,{timeout:1000,retryCount:0})});
 const start=Date.now();while(true){try{if(await client.getChainId()===143)break;}catch{}if(Date.now()-start>90_000)throw new Error('Local Anvil did not start');await pause(300);}
 // This key exists only in process memory and is funded only on the isolated local node.
 key=generatePrivateKey();const account=privateKeyToAccount(key);await rpc('anvil_setBalance',[account.address,toHex(1000n*10n**18n)]);
 const writer=await transactionWriter(directory,{url,key,enabled:true});
 const root=fileURLToPath(new URL('../../../',import.meta.url)),artifact=JSON.parse(await readFile(join(root,'contracts/out/CaseBook.sol/CaseBook.json'),'utf8'));
 address=(await writer.send('local-deployment',encodeDeployData({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[account.address]}),null)).address;
 publisher=new PuzzlePublisher(join(directory,'publications'),new CaseVault(join(directory,'vault'),randomBytes(32)),await puzzleChain(directory,address,{url,key,enabled:true}),()=>clock);
},180_000);
afterAll(async()=>{if(!enabled)return;child?.kill('SIGTERM');await pause(500);if(directory)await rm(directory,{recursive:true,force:true});},30_000);

run('a daily case is locked on chain before it opens, revealed after it closes, and passes independent verification',async()=>{
 const client=createPublicClient({chain:monad,transport:http(url,{timeout:5000})}),chainId=chainCaseId(puzzle.file.id);
 clock=(opensAt-1800)*1000;
 expect((await publisher.prepare(puzzle,'FRESH')).status).toBe('PREPARED');
 const committed=await publisher.publish('2026-10-04');expect(committed.status).toBe('COMMITTED');expect(committed.publishedAt).toBeNull();
 expect(await client.readContract({address,abi:casebookAbi,functionName:'caseOf',args:[chainId]})).toEqual([puzzle.answerHash,false]);
 expect((await verifyPuzzlePublication(committed,null,url)).status).toBe('NOT_PUBLISHED');
 clock=(opensAt+60)*1000;
 const published=await publisher.publish('2026-10-04');expect(published.status).toBe('PUBLISHED');
 expect((await verifyPuzzlePublication(published,null,url)).status).toBe('COMMITMENT_VERIFIED');
 await expect(publisher.close('2026-10-04')).rejects.toThrow('PUBLISH_EARLY');
 await rpc('evm_setNextBlockTimestamp',[closesAt+1]);await rpc('evm_mine',[]);clock=(closesAt+120)*1000;
 const closed=await publisher.close('2026-10-04');expect(closed.status).toBe('CAST_RECORDED');
 const done=await publisher.recordSolves('2026-10-04',[{tokenId:1462,solved:true,perfect:true,caught:['A','B','C'],grade:'A'},{tokenId:7,solved:false,perfect:false,caught:['A'],grade:'D'}]);
 expect(done.status).toBe('COMPLETE');expect(done.solveCount).toBe(2);
 expect(await client.readContract({address,abi:casebookAbi,functionName:'solveRecorded',args:[chainId,1462]})).toBe(true);
 expect(await client.readContract({address,abi:casebookAbi,functionName:'solveRecorded',args:[chainId,8]})).toBe(false);
 const result=await verifyPuzzlePublication(done,puzzle.file,url);expect(result.status).toBe('PASS');
 // A changed public file cannot reuse the revealed key.
 const edited=structuredClone(puzzle.file);edited.receipts[0]!.text+=' Seen twice.';
 await expect(verifyPuzzlePublication(done,edited,url)).rejects.toThrow('VERIFY_KEY');
 // Every step resumes from its journal; repeating the run signs nothing new.
 const writer=await transactionWriter(directory,{url,key,enabled:true}),nonce=await writer.client.getTransactionCount({address:writer.account.address});
 expect(await publisher.close('2026-10-04')).toEqual(done);expect(await publisher.recordSolves('2026-10-04',[])).toEqual(done);
 expect(await writer.client.getTransactionCount({address:writer.account.address})).toBe(nonce);
},300_000);

run('a different key cannot replace the case already prepared for that day',async()=>{
 const other=buildDailyPuzzle({day:'2026-10-04',salt:'0x'+'b2'.repeat(32),previous:[],history:fixture.rows,times:new Map(fixture.times),metadata:new Map(tokens.map(row=>[row.tokenId,row.metadata])),ownership,bulkSources:[],rules:config}).puzzle;
 expect(other.file.id).toBe(puzzle.file.id);expect(other.answerHash).not.toBe(puzzle.answerHash);
 await expect(publisher.prepare(other,'FRESH')).rejects.toThrow('PUBLISH_CONFLICT');
},120_000);
