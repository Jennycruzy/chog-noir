import { readFile, writeFile, mkdir } from 'node:fs/promises';
const rows=JSON.parse(await readFile(new URL('../data/wallet-audit/candidates.json',import.meta.url),'utf8')) as {log:{address:string;blockNumber:number};tx:{hash:string}}[];
const root=new URL('../data/wallet-audit/proofs/',import.meta.url);await mkdir(root,{recursive:true});
for(const address of [...new Set(rows.map(row=>row.log.address.toLowerCase()))]){
 const example=rows.filter(row=>row.log.address.toLowerCase()===address).sort((a,b)=>b.log.blockNumber-a.log.blockNumber)[0]!;
 const requests=[{jsonrpc:'2.0',id:1,method:'debug_traceTransaction',params:[example.tx.hash,{tracer:'prestateTracer'}]},
  {jsonrpc:'2.0',id:2,method:'eth_getTransactionReceipt',params:[example.tx.hash]},
  {jsonrpc:'2.0',id:3,method:'eth_getCode',params:[address,'latest']}];
 const fetchedAt=new Date().toISOString();const response=await fetch('https://rpc.monad.xyz',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requests),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`AUDIT_RPC: HTTP ${response.status}`);
 const replies=await response.json();await writeFile(new URL(`${address}.json`,root),JSON.stringify({fetchedAt,address,example:example.tx.hash,requests,replies}));
 console.log(JSON.stringify({address,methods:replies.map((reply:{id:number;error?:unknown;result?:unknown})=>({id:reply.id,error:reply.error??null,present:reply.result!=null}))}));
}
