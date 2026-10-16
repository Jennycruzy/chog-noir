import {mkdir,writeFile} from 'node:fs/promises';
import {loadEnv} from './env.mts';
await loadEnv();
const tx='0x89c8e99142bd0c0419d83b79c316c33996a25b497e35c0af7f5958eb33a9a134';
const block='0x'+(110904305).toString(16);
const requests=[
  {jsonrpc:'2.0',id:4,method:'eth_call',params:[{to:'0x350035555E10d9AfAF1566AaebfCeD5BA6C27777',data:'0x313ce567'},'latest']},
  {jsonrpc:'2.0',id:1,method:'debug_traceTransaction',params:[tx,{tracer:'callTracer'}]},
  {jsonrpc:'2.0',id:2,method:'trace_transaction',params:[tx]},
  {jsonrpc:'2.0',id:3,method:'trace_filter',params:[{fromBlock:block,toBlock:block,toAddress:['0xf5e48aaf087bb5eebb3127e88d161c921529bfff']}]},
];
const directory=new URL('../runs/trace-check/',import.meta.url);await mkdir(directory,{recursive:true});
for(const request of requests) {
  const fetchedAt=new Date().toISOString();
  const response=await fetch(process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});
  const reply=await response.json() as {result?:unknown;error?:{code:number;message:string}};
  await writeFile(new URL(`${request.method}.json`,directory),JSON.stringify({fetchedAt,request,status:response.status,reply},null,2));
  console.log(JSON.stringify({method:request.method,status:response.status,resultPresent:reply.result!==undefined,error:reply.error}));
}
