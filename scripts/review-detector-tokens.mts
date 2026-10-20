import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from './env.mts';
import { decodeAbiParameters, parseAbiParameters, toFunctionSelector } from 'viem';
await loadEnv();
if (!process.env.ETHERSCAN_API_KEY) throw new Error('AUDIT_KEY: Etherscan key missing');
const rows=JSON.parse(await readFile(new URL('../data/wallet-records/candidates.json',import.meta.url),'utf8')) as {log:{address:string;blockNumber:number};tx:{input:string}}[];
const tokens=[...new Set(rows.map(row=>row.log.address.toLowerCase()))];
const root=new URL('../data/wallet-records/tokens/',import.meta.url);await mkdir(root,{recursive:true});
async function rpc(method:string,params:unknown[]){const request={jsonrpc:'2.0',id:1,method,params};const fetchedAt=new Date().toISOString();const response=await fetch('https://rpc.monad.xyz',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});const reply=await response.json();return {fetchedAt,request,reply};}
for(const address of tokens){
  const request={chainid:'143',module:'contract',action:'getsourcecode',address};
  const url=new URL('https://api.etherscan.io/v2/api');for(const[k,v]of Object.entries(request))url.searchParams.set(k,v);url.searchParams.set('apikey',process.env.ETHERSCAN_API_KEY!);
  const fetchedAt=new Date().toISOString();let response:Response;try{response=await fetch(url,{signal:AbortSignal.timeout(30000)});}catch{throw new Error('AUDIT_SOURCE: Explorer request failed');}
  const reply=await response.json();if(reply.status!=='1'||!Array.isArray(reply.result))throw new Error('AUDIT_SOURCE: Source API refused the query');
  const symbol=await rpc('eth_call',[{to:address,data:'0x95d89b41'},'latest']);
  const code=await rpc('eth_getCode',[address,`0x${rows.find(row=>row.log.address.toLowerCase()===address)!.log.blockNumber.toString(16)}`]);
  const saved={address,source:{fetchedAt,request,reply},symbol,code};await writeFile(new URL(`${address}.json`,root),JSON.stringify(saved));
  let display:string|null=null;try{display=decodeAbiParameters(parseAbiParameters('string'),symbol.reply.result)[0];}catch{}
  let methods:unknown[]=[];try{const abi=JSON.parse(reply.result[0].ABI);methods=abi.filter((item:{type:string})=>item.type==='function').map((item:{name:string;inputs:{type:string}[]})=>({name:item.name,selector:toFunctionSelector(`${item.name}(${item.inputs.map(arg=>arg.type).join(',')})`)}));}catch{}
  console.log(JSON.stringify({address,symbol:display,contract:reply.result[0].ContractName,verified:!!reply.result[0].SourceCode,methods}));
  await new Promise(resolve=>setTimeout(resolve,1100));
}
