import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createPublicClient,http} from 'viem';
import {HypersyncClient,type Query} from '@envio-dev/hypersync-client';
import {monad} from '../../packages/chain/src/client.mts';
import {CHOG,TRANSFER_TOPIC,type ChainLog,type Classification} from '../../packages/core/src/chain.mts';
import {classifyTransaction} from '../../packages/core/src/classify.mts';
import {enrichHistory} from '../../packages/core/src/enrich.mts';
import {eventTopics,type StoredHistory} from '../../scripts/data-types.mts';
import {atomicJSON} from '../../packages/publishing/src/vault.mts';
const stringify=(value:unknown)=>JSON.stringify(value,(_,field)=>typeof field==='bigint'?field.toString():field);
export async function collectDaily(root:string){
 if(!process.env.HYPERSYNC_TOKEN)throw new Error('DAILY_HISTORY: HyperSync token is not configured');
 const rpc=createPublicClient({chain:monad,transport:http(process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz',{timeout:30_000})});
 if(await rpc.getChainId()!==143)throw new Error('DAILY_CHAIN: Monad mainnet required');
 const finalized=await rpc.getBlock({blockTag:'finalized'});
 const client=new HypersyncClient({url:'https://monad.hypersync.xyz',apiToken:process.env.HYPERSYNC_TOKEN});
 const height=Math.min(await client.getHeight(),Number(finalized.number)+1);
 const directory=join(root,'runs/daily/source');await mkdir(directory,{recursive:true,mode:0o700});
 let previous:StoredHistory;
 try{previous=JSON.parse(await readFile(join(directory,'history.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;previous=JSON.parse(await readFile(join(root,'data/related/history.json'),'utf8'));}
 const from=Math.max(0,previous.toBlockExclusive-1000);
 if(height<=from)throw new Error('DAILY_HISTORY: Provider is behind the saved finalized history');
 const batch=join(directory,new Date().toISOString().replaceAll(':','-'));await mkdir(batch,{recursive:true,mode:0o700});
 const added:StoredHistory['data']={blocks:[],transactions:[],logs:[]};let cursor=from,page=0;
 while(cursor<height){
  const query:Query={fromBlock:cursor,toBlock:height,joinMode:1,logs:[{address:[CHOG],topics:[[TRANSFER_TOPIC]]}],fieldSelection:{block:['Number','Hash','Timestamp'],transaction:['Hash','BlockNumber','TransactionIndex','From','To','Input','Value','Status'],log:['BlockNumber','TransactionHash','TransactionIndex','LogIndex','Address','Data','Topic0','Topic1','Topic2','Topic3']}};
  const fetchedAt=new Date().toISOString(),reply=await client.get(query);
  if(!Number.isSafeInteger(reply.nextBlock)||reply.nextBlock<=cursor)throw new Error('DAILY_PAGINATION: History did not advance');
  await writeFile(join(batch,`page-${page++}.json`),stringify({fetchedAt,query,reply}),{mode:0o600});
  const normalized=JSON.parse(stringify(reply.data)) as StoredHistory['data'];
  added.blocks.push(...normalized.blocks);added.transactions.push(...normalized.transactions);added.logs.push(...normalized.logs);
  cursor=reply.nextBlock;
 }
 const unique=<T,>(items:T[],identity:(item:T)=>string)=>{
  const map=new Map<string,T>();for(const item of items){const id=identity(item),saved=map.get(id);if(saved&&JSON.stringify(saved)!==JSON.stringify(item))throw new Error('DAILY_SOURCE_CONFLICT: Conflicting canonical source records');map.set(id,item);}return [...map.values()];
 };
 const data={
  blocks:unique([...previous.data.blocks.filter(block=>block.number<from),...added.blocks],block=>String(block.number)),
  transactions:unique([...previous.data.transactions.filter(tx=>tx.blockNumber<from),...added.transactions],tx=>tx.hash.toLowerCase()),
  logs:unique([...previous.data.logs.filter(log=>log.blockNumber<from),...added.logs],log=>`${log.transactionHash.toLowerCase()}:${log.logIndex}`),
 };
 const known=JSON.parse(await readFile(join(root,'runs/classification/events.json'),'utf8')) as {events:Classification[]};
 const old=new Map(known.events.map(event=>[`${event.tx}:${event.logIndex}`,event]));
 const byTx=new Map<string,ChainLog[]>();for(const raw of data.logs){const log={...raw,topics:eventTopics(raw.topics)};const list=byTx.get(log.transactionHash)??[];list.push(log);byTx.set(log.transactionHash,list);}
 const events=data.transactions.flatMap(tx=>classifyTransaction(tx,byTx.get(tx.hash)??[]).map(event=>old.get(`${event.tx}:${event.logIndex}`)??event));
 const times=new Map(data.blocks.map(block=>[block.number,block.timestamp]));
 const enriched=enrichHistory(events,times);
 const coverageAt=Math.min(Number(finalized.timestamp),Number((await rpc.getBlock({blockNumber:BigInt(height-1)})).timestamp));
 const snapshot={finishedAt:new Date().toISOString(),toBlockExclusive:height,finalizedBlock:Number(finalized.number),finalizedHash:finalized.hash,coverageAt,sourceFromBlock:from,data};
 await atomicJSON(join(directory,'history.json'),snapshot);await atomicJSON(join(directory,'enriched.json'),{events:enriched});
 return {history:enriched,times,coverageAt,rpc,data,toBlockExclusive:height};
}
