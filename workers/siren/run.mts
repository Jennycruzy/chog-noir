import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createPublicClient,http,type Hex} from 'viem';
import WebSocket from 'ws';
import {loadEnv} from '../../scripts/env.mts';
import {monad} from '../../packages/chain/src/client.mts';
import {CHOG,TRANSFER_TOPIC,type ChainLog} from '../../packages/core/src/chain.mts';
import {classifyTransaction} from '../../packages/core/src/classify.mts';
import {atomicJSON} from '../../packages/publishing/src/vault.mts';
import {safeError} from '../../scripts/errors.mts';
import {nativeBand,type FeedEvent} from '../../packages/indexer/src/feed.mts';
async function main(){
await loadEnv();
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=join(root,'runs/live');await mkdir(join(directory,'receipts'),{recursive:true,mode:0o700});
const client=createPublicClient({chain:monad,transport:http(process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz',{timeout:15_000,retryCount:1})});
if(await client.getChainId()!==143)throw new Error('SIREN_CHAIN: Monad mainnet required');
interface Checkpoint {cursor:number;blockHash:Hex|null;events:FeedEvent[];startedAt:string}
let checkpoint:Checkpoint;
try{checkpoint=JSON.parse(await readFile(join(directory,'checkpoint.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const head=await client.getBlock({blockTag:'finalized'});checkpoint={cursor:Math.max(0,Number(head.number)-100),blockHash:null,events:[],startedAt:new Date().toISOString()};}
let review=false,alive=true,stopped=false,syncing=false,subscribed=false,socket:WebSocket|null=null,reconnect:ReturnType<typeof setTimeout>|undefined;
async function writeFeed(state:string,note:string,finalized:number|null=null){await atomicJSON(join(directory,'feed.json'),{updatedAt:new Date().toISOString(),state,note,finalizedBlock:finalized,fromBlock:checkpoint.cursor,startedAt:checkpoint.startedAt,events:checkpoint.events.slice(-50)});}
async function sync(){
 if(stopped||syncing)return;syncing=true;
 try{
  const finalized=await client.getBlock({blockTag:'finalized'}),height=Number(finalized.number);
  if(checkpoint.blockHash&&checkpoint.cursor>0){const last=await client.getBlock({blockNumber:BigInt(checkpoint.cursor-1)});if(last.hash!==checkpoint.blockHash){throw new Error('SIREN_REORG: Saved canonical block changed');}}
  for(let batch=0;checkpoint.cursor<=height&&batch<20;batch++){
   const end=Math.min(checkpoint.cursor+99,height),raw=await client.getLogs({address:CHOG,fromBlock:BigInt(checkpoint.cursor),toBlock:BigInt(end)});
   const logs=raw.filter(log=>log.topics[0]===TRANSFER_TOPIC&&log.topics.length===4&&!log.removed),hashes=[...new Set(logs.map(log=>log.transactionHash!))];
   const additions:FeedEvent[]=[];
   for(const hash of hashes){
    const [tx,receipt]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash})]);
    if(receipt.status!=='success'||receipt.blockNumber>finalized.number)throw new Error('SIREN_RECEIPT: Transaction is not in the finalized source range');
    const block=await client.getBlock({blockNumber:receipt.blockNumber});if(block.hash!==receipt.blockHash)throw new Error('SIREN_REORG: Transaction block changed');
    const related:ChainLog[]=receipt.logs.map(log=>({address:log.address,topics:log.topics,data:log.data,transactionHash:log.transactionHash,blockNumber:Number(log.blockNumber),logIndex:log.logIndex}));
    const events=classifyTransaction({hash:tx.hash,from:tx.from,to:tx.to,input:tx.input,blockNumber:Number(tx.blockNumber)},related);
    for(const event of events)if(event.class==='SALE'&&event.price?.status==='EXACT'&&event.price.grossWei&&event.route)additions.push({id:`${event.tx}:${event.logIndex}`,tx:event.tx,block:event.block,logIndex:event.logIndex,tokenId:event.tokenId,time:new Date(Number(block.timestamp)*1000).toISOString(),priceBand:nativeBand(BigInt(event.price.grossWei)),route:event.route,grossWei:event.price.grossWei,asset:event.price.asset});
    await atomicJSON(join(directory,'receipts',hash+'.json'),JSON.parse(JSON.stringify({transaction:tx,receipt},(_,value)=>typeof value==='bigint'?value.toString():value)));
   }
   const events=new Map(checkpoint.events.map(event=>[event.id,event]));for(const event of additions){const previous=events.get(event.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(event))throw new Error('SIREN_CONFLICT: Source identity changed');events.set(event.id,event);}
   const block=await client.getBlock({blockNumber:BigInt(end)});checkpoint={...checkpoint,cursor:end+1,blockHash:block.hash,events:[...events.values()].sort((a,b)=>a.block-b.block||a.logIndex-b.logIndex).slice(-50)};
   await atomicJSON(join(directory,'checkpoint.json'),checkpoint);
  }
  await writeFeed(checkpoint.cursor<=height?'CATCHING_UP':subscribed?'LIVE':'POLLING','Sales are decoded from successful receipts in the RPC’s finalized block range. Prices exclude unsupported routes.',height);
 }catch(error){
  console.error('SIREN_SOURCE_FAILED',safeError(error));
  if(error instanceof Error&&/^SIREN_(REORG|CONFLICT):/.test(error.message)){review=true;stopped=true;await writeFeed('REVIEW','The saved canonical source changed. Ingestion has stopped for review.');void stop().then(()=>process.exit(1));}
  else await writeFeed('RECONNECTING','The source could not be refreshed. Existing records are retained; no new sale is inferred.');
 }
 finally{syncing=false;}
}
function connect(){
 if(stopped)return;
 const connection=new WebSocket(process.env.MONAD_RPC_WS??'wss://rpc.monad.xyz',{handshakeTimeout:15000});socket=connection;
 connection.on('open',()=>{alive=true;connection.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_subscribe',params:['logs',{address:CHOG,topics:[TRANSFER_TOPIC]}]}));});
 connection.on('pong',()=>{if(socket===connection)alive=true;});
 connection.on('message',bytes=>{if(socket!==connection)return;try{const value=JSON.parse(bytes.toString());if(value.id===1&&typeof value.result==='string')subscribed=true;if(value.method==='eth_subscription'||value.id===1)void sync();}catch(error){console.error('SIREN_WS_MESSAGE',safeError(error));connection.terminate();}});
 connection.on('error',error=>{console.error('SIREN_WS_FAILED',safeError(error));connection.terminate();});
 connection.on('close',()=>{if(socket!==connection)return;subscribed=false;if(!stopped)reconnect=setTimeout(connect,5000);});
}
const poll=setInterval(()=>{void sync();},2000),heartbeat=setInterval(()=>{if(socket?.readyState===WebSocket.OPEN){if(!alive){console.error('SIREN_WS_TIMEOUT: No heartbeat response');socket.terminate();return;}alive=false;socket.ping();}},20000);
connect();await sync();
async function stop(){stopped=true;clearInterval(poll);clearInterval(heartbeat);clearTimeout(reconnect);socket?.close();while(syncing)await new Promise(resolve=>setTimeout(resolve,100));if(!review)await writeFeed('STOPPED','The live worker has been stopped. Saved records remain available.');}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop().then(()=>process.exit(0));});

}
await main().catch(error=>{console.error('SIREN_START_FAILED',safeError(error));process.exit(1);});
