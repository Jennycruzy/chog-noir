import {test,expect,beforeAll,afterAll} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import {createPublicClient,http,encodeDeployData,encodeFunctionData,toHex,keccak256,type Hex} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {transactionWriter,recoverCaseOpened,monad,type SignedJournal} from '../src/client.mts';
import {casebookAbi,chainCaseId} from '../src/casebook.mts';
const binary=process.env.ANVIL_PATH??'/home/ubuntu/.foundry/bin/anvil';
const enabled=existsSync(binary),run=test.skipIf(!enabled);
let child:ChildProcess|undefined,directory:string,url:string,key:Hex,deployed:`0x${string}`;
let writer:Awaited<ReturnType<typeof transactionWriter>>;
beforeAll(async()=>{
 if(!enabled)return;
 directory=await mkdtemp(join(tmpdir(),'chog-chain-test-'));
 const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
 url=`http://127.0.0.1:${port}`;
 child=spawn(binary,['--host','127.0.0.1','--port',String(port),'--chain-id','143','--block-time','1','--slots-in-an-epoch','1','--silent'],{stdio:'ignore'});
 const client=createPublicClient({chain:monad,transport:http(url,{timeout:1000,retryCount:0})});
 const start=Date.now();while(true){try{if(await client.getChainId()===143)break;}catch{}if(Date.now()-start>90_000)throw new Error('Local Anvil did not start');await pause(300);}
 // This key exists only in process memory and is funded only on the isolated local node.
 key=generatePrivateKey();const account=privateKeyToAccount(key);
 const funded=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'anvil_setBalance',params:[account.address,toHex(1000n*10n**18n)]})}).then(response=>response.json());if(funded.error)throw new Error('Local test funding failed');
 writer=await transactionWriter(directory,{url,key,enabled:true});
 const root=fileURLToPath(new URL('../../../',import.meta.url)),artifact=JSON.parse(await readFile(join(root,'contracts/out/CaseBook.sol/CaseBook.json'),'utf8'));
 const data=encodeDeployData({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[account.address]});
 deployed=(await writer.send('local-deployment',data,null)).address;
},120_000);
afterAll(async()=>{if(!enabled)return;child?.kill('SIGTERM');await pause(500);if(directory)await rm(directory,{recursive:true,force:true});},30_000);
run('a persisted signed transaction resumes after a lost receipt-save without spending another nonce',async()=>{
 const data=encodeFunctionData({abi:casebookAbi,functionName:'openCase',args:[chainCaseId('local-case'),'0x'+'12'.repeat(32) as Hex,1n,BigInt(Math.floor(Date.now()/1000)+3600)]});
 const first=await writer.send('local-case-open',data,deployed,deployed);
 const count=await writer.client.getTransactionCount({address:writer.account.address});
 const file=join(directory,'runs/chain/transactions/local-case-open.json'),journal=JSON.parse(await readFile(file,'utf8')) as SignedJournal;journal.receipt=null;await writeFile(file,JSON.stringify(journal));
 const restarted=await transactionWriter(directory,{url,key,enabled:true});const second=await restarted.send('local-case-open',data,deployed,deployed);
 expect(second.hash).toBe(first.hash);expect(await restarted.client.getTransactionCount({address:restarted.account.address})).toBe(count);
},120_000);
run('a changed transaction cannot reuse a saved journal label',async()=>{
 const path=join(directory,'runs/chain/transactions/local-case-open.json'),journal=JSON.parse(await readFile(path,'utf8')) as SignedJournal;
 await expect(writer.send('local-case-open',('0x'+journal.data.slice(4)) as Hex,deployed,deployed)).rejects.toThrow('changed transaction intent');
},30_000);
run('gas caps are checked before a transaction is signed or broadcast',async()=>{
 const bounded=await transactionWriter(directory,{url,key,enabled:true,maxCostWei:1n});
 const data=encodeFunctionData({abi:casebookAbi,functionName:'openCase',args:[chainCaseId('too-expensive'),'0x'+'34'.repeat(32) as Hex,1n,BigInt(Math.floor(Date.now()/1000)+3600)]});
 await expect(bounded.send('over-cap',data,deployed,deployed)).rejects.toThrow('gas exceeds');
 expect(existsSync(join(directory,'runs/chain/transactions/over-cap.json'))).toBe(false);
},30_000);
run('a dropped transaction is replaced with the same intent and nonce while both hashes are retained',async()=>{
 const data=encodeFunctionData({abi:casebookAbi,functionName:'openCase',args:[chainCaseId('dropped-case'),'0x'+'78'.repeat(32) as Hex,1n,BigInt(Math.floor(Date.now()/1000)+3600)]});
 const nonce=await writer.client.getTransactionCount({address:writer.account.address,blockTag:'pending'}),gas=await writer.client.estimateGas({account:writer.account,to:deployed,data}),gasPrice=await writer.client.getGasPrice();
 const raw=await writer.account.signTransaction({chainId:143,type:'legacy',nonce,gas,gasPrice,to:deployed,data,value:0n}),hash=keccak256(raw),path=join(directory,'runs/chain/transactions/dropped-case-open.json');
 const saved:SignedJournal={v:1,hash,raw,nonce,chainId:143,to:deployed,data,receipt:null,attempts:[{hash,raw,signedAt:Date.now()-600_001}]};await writeFile(path,JSON.stringify(saved));
 const guarded=await transactionWriter(directory,{url,key,enabled:true});await expect(guarded.send('dropped-case-open',data,deployed,deployed)).rejects.toThrow('CHAIN_REPLACEMENT_UNVERIFIED');
 const capped=await transactionWriter(directory,{url,key,enabled:true,replacementVerified:true,maxCostWei:gas*gasPrice});await expect(capped.send('dropped-case-open',data,deployed,deployed)).rejects.toThrow('Replacement exceeds');
 expect((JSON.parse(await readFile(path,'utf8')) as SignedJournal).attempts).toHaveLength(1);
 const resumed=await transactionWriter(directory,{url,key,enabled:true,replacementVerified:true});const result=await resumed.send('dropped-case-open',data,deployed,deployed),journal=JSON.parse(await readFile(path,'utf8')) as SignedJournal;
 expect(journal.attempts).toHaveLength(2);expect(journal.attempts![0]!.hash).toBe(hash);expect(result.hash).toBe(journal.attempts![1]!.hash);
 const transaction=await writer.client.getTransaction({hash:result.hash});expect(transaction.nonce).toBe(nonce);expect(transaction.input).toBe(data);expect(transaction.to?.toLowerCase()).toBe(deployed.toLowerCase());expect(transaction.gasPrice).toBe((gasPrice*125n+99n)/100n);
 expect(await writer.client.getTransactionCount({address:writer.account.address})).toBe(nonce+1);
 const [answer]=await writer.client.readContract({address:deployed,abi:casebookAbi,functionName:'caseOf',args:[chainCaseId('dropped-case')]});expect(answer).toBe('0x'+'78'.repeat(32));
},120_000);

run('a confirmed CaseOpened event recovers the original receipt without another nonce',async()=>{
 const commitment={id:'recoverable-case',answerHash:'0x'+'9a'.repeat(32)},opensAt=1,closesAt=Math.floor(Date.now()/1000)+3600;
 const data=encodeFunctionData({abi:casebookAbi,functionName:'openCase',args:[chainCaseId(commitment.id),commitment.answerHash as Hex,BigInt(opensAt),BigInt(closesAt)]});
 const first=await writer.send('recoverable-case-open',data,deployed,deployed),nonce=await writer.client.getTransactionCount({address:writer.account.address});
 await rm(join(directory,'runs/chain/transactions/recoverable-case-open.json'));
 const recovered=await recoverCaseOpened(writer.client,deployed,commitment,opensAt,closesAt,BigInt(first.blockNumber));expect(recovered).toEqual(first);expect(await writer.client.getTransactionCount({address:writer.account.address})).toBe(nonce);
 await expect(recoverCaseOpened(writer.client,deployed,commitment,opensAt,closesAt+1,BigInt(first.blockNumber))).rejects.toThrow('CHAIN_RECOVERY_CONFLICT');
},120_000);
