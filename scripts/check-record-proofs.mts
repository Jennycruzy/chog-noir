import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {statelessEmitter} from '../packages/detector/src/records.mts';
const directory=resolve(process.argv[2]??'runs/wallet-records-20261017');
const rows=JSON.parse(await readFile(join(directory,'candidates.json'),'utf8')) as {log:{address:string;topics:string[]};tx:{hash:string}}[];
const wallets=new Set<string>(JSON.parse(await readFile(join(directory,'wallets.json'),'utf8')));
const archive=process.argv.includes('--archive');
const provider=archive?'https://rpc2.monad.xyz':'https://rpc.monad.xyz';
const root=join(directory,archive?'transaction-proofs-goldsky':'transaction-proofs');await mkdir(root,{recursive:true});
async function rpc(request:unknown){const response=await fetch(provider,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error(`RPC HTTP ${response.status}`);return response.json();}
const eligible=new Set<string>();
for(const address of new Set(rows.map(row=>row.log.address.toLowerCase()))){
 const request={jsonrpc:'2.0',id:1,method:'eth_getCode',params:[address,'latest']};const fetchedAt=new Date().toISOString();const reply=await rpc(request);
 await writeFile(join(root,`code-${address}.json`),JSON.stringify({provider,fetchedAt,request,reply}));
 if(typeof reply.result==='string'&&statelessEmitter(reply.result))eligible.add(address);
}
const transactions=[...new Set(rows.filter(row=>wallets.has('0x'+row.log.topics[1]!.slice(-40))&&eligible.has(row.log.address.toLowerCase())).map(row=>row.tx.hash))];
let next=0,done=0,errors=0;
async function worker(){while(next<transactions.length){const tx=transactions[next++]!;const file=join(root,`${tx}.json`);try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.reply.error)errors++;done++;continue;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const request={jsonrpc:'2.0',id:1,method:'debug_traceTransaction',params:[tx,{tracer:'prestateTracer'}]};const fetchedAt=new Date().toISOString();let reply;
 try{reply=await rpc(request);if(reply.error)errors++;}catch{reply={error:'Execution-time proof unavailable'};errors++;}
 await writeFile(`${file}.tmp`,JSON.stringify({provider,fetchedAt,request,reply}));
 await rename(`${file}.tmp`,file);
 done++;if(done%20===0)console.log(JSON.stringify({done,total:transactions.length,errors}));
}}
await Promise.all([worker(),worker()]);
await writeFile(join(root,'summary.json'),JSON.stringify({provider,finishedAt:new Date().toISOString(),transactions:transactions.length,done,errors,eligibleTokens:[...eligible]},null,2));
console.log(JSON.stringify({finished:true,done,errors}));
