import {test,expect,beforeAll,afterAll} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import {createPublicClient,createWalletClient,http,encodeFunctionData,parseAbi,parseUnits,toHex,type Hex,type Address} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {monad} from '../../chain/src/client.mts';
import {CHOG_TOKEN} from '../../core/src/chain.mts';
import {ChogBurns,DEAD} from '../src/burns.mts';

const binary=process.env.ANVIL_PATH??'/home/ubuntu/.foundry/bin/anvil',enabled=existsSync(binary),run=test.skipIf(!enabled);
const abi=parseAbi(['function mint(address to,uint256 amount)','function transfer(address to,uint256 amount) returns (bool)']);
let child:ChildProcess|undefined,directory:string,url:string;
const rpc=async(method:string,params:unknown[])=>{const reply=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(response=>response.json());if(reply.error)throw new Error(method+' failed');return reply.result;};
beforeAll(async()=>{
 if(!enabled)return;
 directory=await mkdtemp(join(tmpdir(),'chog-burns-'));
 const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
 url=`http://127.0.0.1:${port}`;
 child=spawn(binary,['--host','127.0.0.1','--port',String(port),'--chain-id','143','--block-time','1','--slots-in-an-epoch','1','--silent'],{stdio:'ignore'});
 const client=createPublicClient({chain:monad,transport:http(url,{timeout:1000,retryCount:0})});
 const start=Date.now();while(true){try{if(await client.getChainId()===143)break;}catch{}if(Date.now()-start>90_000)throw new Error('Local Anvil did not start');await pause(300);}
 // On this isolated local chain only, a minimal ERC-20 stands at the $CHOG address.
 const artifact=JSON.parse(await readFile(join(fileURLToPath(new URL('../../../',import.meta.url)),'contracts/out/TestToken.sol/TestToken.json'),'utf8'));
 await rpc('anvil_setCode',[CHOG_TOKEN,artifact.deployedBytecode.object]);
},120_000);
afterAll(async()=>{if(!enabled)return;child?.kill('SIGTERM');await pause(500);if(directory)await rm(directory,{recursive:true,force:true});},30_000);

async function player(balance:string){
 const account=privateKeyToAccount(generatePrivateKey());await rpc('anvil_setBalance',[account.address,toHex(10n**18n)]);
 const wallet=createWalletClient({account,chain:monad,transport:http(url)}),client=createPublicClient({chain:monad,transport:http(url)});
 await client.waitForTransactionReceipt({hash:await wallet.sendTransaction({to:CHOG_TOKEN as Address,data:encodeFunctionData({abi,functionName:'mint',args:[account.address,parseUnits(balance,18)]})})});
 return {account,wallet,client};
}
async function finalized(client:ReturnType<typeof createPublicClient>,hash:Hex){const receipt=await client.waitForTransactionReceipt({hash});while((await client.getBlock({blockTag:'finalized'})).number<receipt.blockNumber)await pause(300);}

run('a burn bound to this case and Chog is credited once, and only after the chain shows it',async()=>{
 const {account,wallet,client}=await player('500'),burns=new ChogBurns({root:directory,client});
 expect(await burns.holds(account.address)).toBe(true);expect(await burns.holds(privateKeyToAccount(generatePrivateKey()).address)).toBe(false);
 const intent=burns.intent('case-'+'1'.repeat(24),11,'a'.repeat(32));
 expect(intent.data.length).toBe(2+(4+32+32+32)*2);
 const hash=await wallet.sendTransaction({to:intent.to,data:intent.data});await finalized(client,hash);
 const credited=await burns.verify({tx:hash,wallet:account.address,caseId:'case-'+'1'.repeat(24),tokenId:11,nonce:'a'.repeat(32)});
 expect(credited.burnedWei).toBe(parseUnits('100',18).toString());
 await expect(burns.verify({tx:hash,wallet:account.address,caseId:'case-'+'1'.repeat(24),tokenId:11,nonce:'a'.repeat(32)})).rejects.toMatchObject({code:'BURN_ALREADY_USED'});
 // The same transaction cannot be presented for another Chog, and another wallet cannot claim it.
 await expect(burns.verify({tx:hash,wallet:account.address,caseId:'case-'+'1'.repeat(24),tokenId:12,nonce:'a'.repeat(32)})).rejects.toMatchObject({code:'BURN_INVALID'});
 await expect(burns.verify({tx:hash,wallet:DEAD,caseId:'case-'+'1'.repeat(24),tokenId:11,nonce:'a'.repeat(32)})).rejects.toMatchObject({code:'BURN_INVALID'});
},120_000);

run('a short burn or an ordinary transfer is never credited',async()=>{
 const {account,wallet,client}=await player('500'),burns=new ChogBurns({root:directory,client}),caseId='case-'+'2'.repeat(24);
 const short=await wallet.sendTransaction({to:CHOG_TOKEN as Address,data:(encodeFunctionData({abi,functionName:'transfer',args:[DEAD,parseUnits('99',18)]})+ChogBurns.memo(caseId,11,'b'.repeat(32)).slice(2)) as Hex});await finalized(client,short);
 await expect(burns.verify({tx:short,wallet:account.address,caseId,tokenId:11,nonce:'b'.repeat(32)})).rejects.toMatchObject({code:'BURN_INVALID'});
 const plain=await wallet.sendTransaction({to:CHOG_TOKEN as Address,data:encodeFunctionData({abi,functionName:'transfer',args:[DEAD,parseUnits('100',18)]})});await finalized(client,plain);
 await expect(burns.verify({tx:plain,wallet:account.address,caseId,tokenId:11,nonce:'b'.repeat(32)})).rejects.toMatchObject({code:'BURN_INVALID'});
 await expect(burns.verify({tx:'0x'+'00'.repeat(32),wallet:account.address,caseId,tokenId:11,nonce:'b'.repeat(32)})).rejects.toMatchObject({code:'BURN_NOT_FOUND'});
},120_000);
