import {readFile,readdir,writeFile} from 'node:fs/promises';
const root=new URL('../data/wallet-records/transaction-proofs/',import.meta.url);
const rows=JSON.parse(await readFile(new URL('../data/wallet-records/candidates.json',import.meta.url),'utf8')) as {tx:{hash:string};log:{address:string;blockNumber:number}}[];
const failed=[];
for(const file of await readdir(root)){if(!/^0x[0-9a-f]{64}\.json$/.test(file))continue;const saved=JSON.parse(await readFile(new URL(file,root),'utf8'));if(saved.reply.error){failed.push(rows.find(row=>row.tx.hash===file.slice(0,-5))!);if(failed.length===3)break;}}
const requests=[{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[] as unknown[]}];
for(const row of failed)requests.push({jsonrpc:'2.0',id:requests.length+1,method:'debug_traceTransaction',params:[row.tx.hash,{tracer:'prestateTracer'}]});
const first=failed[0]!;requests.push({jsonrpc:'2.0',id:requests.length+1,method:'eth_getCode',params:[first.log.address,`0x${first.log.blockNumber.toString(16)}`]});
const provider='https://rpc2.monad.xyz',fetchedAt=new Date().toISOString();
const response=await fetch(provider,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requests),signal:AbortSignal.timeout(60000)});
const replies=await response.json();await writeFile(new URL('../data/wallet-records/archive-probe.json',import.meta.url),JSON.stringify({provider,fetchedAt,requests,replies}));
if(!Array.isArray(replies)||replies.find(reply=>reply.id===1)?.result!=='0x8f')throw new Error('ARCHIVE_CHAIN: Wrong chain or invalid replies');
console.log(JSON.stringify(replies.map(reply=>({id:reply.id,error:reply.error??null,resultPresent:reply.result!=null})),null,2));
