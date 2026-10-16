import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {loadEnv} from './env.mts';
import {loadEscrow} from './load-escrow.mts';
import {EscrowIndex} from '../packages/core/src/escrow.mts';
import {CHOG,TRANSFER_TOPIC,decodeTransfer,ZERO} from '../packages/core/src/chain.mts';
import {type StoredHistory,hasErrorCode} from './data-types.mts';
await loadEnv();
const history=JSON.parse(await readFile(new URL('../data/related/history.json',import.meta.url),'utf8')) as StoredHistory;
const input=await loadEscrow(history.toBlockExclusive);
const index=new EscrowIndex(input,history.data.logs.filter(log=>log.address.toLowerCase()===CHOG&&log.topics[0]===TRANSFER_TOPIC).map(decodeTransfer));
const hashes=[...new Set(index.deals.filter(deal=>deal.sold&&deal.paymentToken===ZERO).map(deal=>deal.sold!.tx))];
const directory=new URL('../data/escrow-traces/',import.meta.url);await mkdir(directory,{recursive:true});
let saved=0;
for(const tx of hashes) {
  const file=new URL(`${tx}.json`,directory);
  try {const cached=JSON.parse(await readFile(file,'utf8'));if(cached.request?.params?.[0]===tx&&cached.reply?.result){saved++;continue;}} catch(error){if(!hasErrorCode(error,'ENOENT'))throw error;}
  const request={jsonrpc:'2.0',id:1,method:'debug_traceTransaction',params:[tx,{tracer:'callTracer'}]};
  let complete=false;
  for(let attempt=0;attempt<5;attempt++) {
    const fetchedAt=new Date().toISOString();
    const response=await fetch(process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});
    if(response.status===429){await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));continue;}
    if(!response.ok)throw new Error(`DATA_TRACE_RPC: HTTP ${response.status}`);
    const reply=await response.json() as {result?:unknown;error?:{code:number}};
    if(reply.error||!reply.result)throw new Error(`DATA_TRACE_RPC: Missing trace for ${tx}`);
    await writeFile(file,JSON.stringify({fetchedAt,request,reply},null,2));complete=true;saved++;break;
  }
  if(!complete)throw new Error('DATA_TRACE_RPC: Retry limit reached');
  if(saved%10===0)console.log(JSON.stringify({saved,total:hashes.length}));
  await new Promise(resolve=>setTimeout(resolve,150));
}
console.log(JSON.stringify({saved,total:hashes.length}));
