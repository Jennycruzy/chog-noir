import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEnv} from './env.mts';
import {assessPaymentWindow,type BlockSource,type PaymentPage,type PaymentVerification} from '../packages/core/src/payment-window.mts';
import {type Classification} from '../packages/core/src/chain.mts';
import {hasErrorCode} from './data-types.mts';
await loadEnv();
if(!process.env.ETHERSCAN_API_KEY){console.error(JSON.stringify({code:'DATA_PAYMENT_KEY',message:'Create an Etherscan API key at https://etherscan.io/myapikey and save ETHERSCAN_API_KEY in the local .env file.'}));process.exit(1);}
const argument=(name:string)=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const hash=argument('--tx');const index=argument('--log-index');
if(!hash||!/^0x[0-9a-f]{64}$/i.test(hash)||!index||!/^\d+$/.test(index))throw new Error('DATA_PAYMENT_INPUT: Supply --tx and --log-index from a real classified event');
const records=JSON.parse(await readFile(new URL('../runs/classification/events.json',import.meta.url),'utf8')) as {events:Classification[]};
const transfer=records.events.find(event=>event.tx===hash.toLowerCase()&&event.logIndex===Number(index));
if(!transfer)throw new Error('DATA_PAYMENT_INPUT: Classified event not found');
const root=new URL('../data/payment-windows/',import.meta.url);await mkdir(root,{recursive:true});
async function rpc(method:string,params:unknown[]) {
  const request={jsonrpc:'2.0',id:1,method,params};
  const fetchedAt=new Date().toISOString();
  const response=await fetch(process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`DATA_PAYMENT_RPC: HTTP ${response.status}`);
  const reply=await response.json() as {result?:unknown;error?:unknown};
  if(reply.error||reply.result==null)throw new Error('DATA_PAYMENT_RPC: RPC reply missing');
  return {fetchedAt,request,reply};
}
async function block(number:number):Promise<BlockSource> {
  const id=number.toString(16);const file=new URL(`block-${id}.json`,root);
  let saved:Awaited<ReturnType<typeof rpc>>;
  try{saved=JSON.parse(await readFile(file,'utf8'));}catch(error){if(!hasErrorCode(error,'ENOENT'))throw error;saved=await rpc('eth_getBlockByNumber',[`0x${id}`,false]);await writeFile(file,JSON.stringify(saved));}
  const raw=saved.reply.result as {number:string;hash:string;timestamp:string};
  if(!raw||!/^0x[0-9a-f]+$/i.test(raw.number)||Number(BigInt(raw.number))!==number||!/^0x[0-9a-f]+$/i.test(raw.timestamp))throw new Error('DATA_PAYMENT_BLOCK: Invalid RPC block');
  return {block:{number,hash:raw.hash,timestamp:Number(BigInt(raw.timestamp))},api:{fetchedAt:saved.fetchedAt,request:saved.request}};
}
const chain=await rpc('eth_chainId',[]);if(chain.reply.result!=='0x8f')throw new Error('DATA_PAYMENT_CHAIN: RPC is not Monad mainnet');
const latest=await rpc('eth_blockNumber',[]);const height=Number(BigInt(latest.reply.result as string));
if(!Number.isSafeInteger(height))throw new Error('DATA_PAYMENT_BLOCK: Invalid chain height');
const center=await block(transfer.block);const head=await block(height);
const start=center.block.timestamp-3600;const end=center.block.timestamp+3600;
if(head.block.timestamp<=end+120)throw new Error('DATA_PAYMENT_PENDING: The full payment window has not closed and confirmed');
async function firstAfter(time:number) {
  let low=0;let high=height;
  while(low<high){const mid=Math.floor((low+high)/2);if((await block(mid)).block.timestamp>time)high=mid;else low=mid+1;}
  return low;
}
const before=await block(Math.max(0,(await firstAfter(start-1))-1));
const after=await block(await firstAfter(end));
if(before.block.timestamp>=start)throw new Error('DATA_PAYMENT_BOUNDARY: Window predates available chain history');
const pages:PaymentPage[]=[];
for(const action of ['txlist','txlistinternal','tokentx'] as const) {
  const seenPages=new Set<string>();
  for(let page=1;;page++) {
    const request:PaymentPage['request']={chainid:'143',module:'account',action,address:transfer.to,startblock:before.block.number+1,endblock:after.block.number-1,page,offset:100,sort:'asc',...(action==='tokentx'?{contractaddress:'0x3bd359c1119da7da1d913d1c4d2b7c461115433a'}:{})};
    const id=createHash('sha256').update(JSON.stringify(request)).digest('hex');const file=new URL(`${id}.json`,root);
    let saved:PaymentPage;
    try{saved=JSON.parse(await readFile(file,'utf8'));}catch(error){
      if(!hasErrorCode(error,'ENOENT'))throw error;
      const url=new URL('https://api.etherscan.io/v2/api');for(const [key,value]of Object.entries(request))url.searchParams.set(key,String(value));url.searchParams.set('apikey',process.env.ETHERSCAN_API_KEY!);
      const fetchedAt=new Date().toISOString();let response:Response;
      try{response=await fetch(url,{signal:AbortSignal.timeout(30000)});}catch{throw new Error('DATA_PAYMENT_API: Account-history request failed');}
      if(!response.ok)throw new Error(`DATA_PAYMENT_API: HTTP ${response.status}`);
      const reply=await response.json() as PaymentPage['reply'];
      if(!Array.isArray(reply.result)||(reply.status!=='1'&&!(reply.status==='0'&&reply.message==='No transactions found'&&reply.result.length===0)))throw new Error('DATA_PAYMENT_API: Account history was refused or incomplete; check key access');
      saved={fetchedAt,request,reply};
      await writeFile(file,JSON.stringify(saved));
      await new Promise(resolve=>setTimeout(resolve,1100));
    }
    const fingerprint=JSON.stringify(saved.reply.result);
    if(Array.isArray(saved.reply.result)&&saved.reply.result.length&&seenPages.has(fingerprint))throw new Error('DATA_PAYMENT_COVERAGE: API repeated a history page');
    seenPages.add(fingerprint);
    pages.push(saved);
    assessPaymentWindow({transfer,center,bounds:{before,after},pages}); // Reject API errors before treating a page as complete.
    if(!Array.isArray(saved.reply.result))throw new Error('DATA_PAYMENT_REPLY: Account-history result missing');
    if(saved.reply.result.length<request.offset)break;
  }
}
const input:Parameters<typeof assessPaymentWindow>[0]={transfer,center,bounds:{before,after},pages};
let assessment=assessPaymentWindow(input);
if(assessment.status==='PAYMENT_OBSERVED') {
  const verifications:Record<string,PaymentVerification>={};
  for(const payment of assessment.payments) {
    if(verifications[payment.tx])continue;
    const receipt=await rpc('eth_getTransactionReceipt',[payment.tx]);
    const blockSource=await block(payment.block);
    const trace=assessment.payments.some(item=>item.tx===payment.tx&&item.asset==='MON')?await rpc('debug_traceTransaction',[payment.tx,{tracer:'callTracer'}]):undefined;
    verifications[payment.tx]={block:blockSource,receipt:receipt as PaymentVerification['receipt'],...(trace?{trace:trace as NonNullable<PaymentVerification['trace']>}:{})};
  }
  input.verifications=verifications;assessment=assessPaymentWindow(input);
}
const output={checkedAt:new Date().toISOString(),input,assessment};
await writeFile(new URL(`${transfer.tx}-${transfer.logIndex}.json`,root),JSON.stringify(output,null,2));
console.log(JSON.stringify({tx:transfer.tx,logIndex:transfer.logIndex,status:assessment.status,pages:pages.length}));
