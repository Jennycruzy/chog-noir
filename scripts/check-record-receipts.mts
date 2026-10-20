import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=join(resolve(process.argv[2]??'runs/wallet-records-20261017'),'transaction-proofs-goldsky');
const files=(await readdir(root)).filter(file=>/^0x[0-9a-f]{64}\.json$/.test(file));
const hashes=[];
for(const file of files){const saved=JSON.parse(await readFile(join(root,file),'utf8'));if(saved.reply.result)hashes.push(file.slice(0,-5));}
const provider='https://rpc2.monad.xyz';let errors=0,verified=0;
for(let offset=0;offset<hashes.length;offset+=10){
 const batch=hashes.slice(offset,offset+10);const requests=batch.map((hash,id)=>({jsonrpc:'2.0',id,method:'eth_getTransactionReceipt',params:[hash]}));
 const fetchedAt=new Date().toISOString();const response=await fetch(provider,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requests),signal:AbortSignal.timeout(60000)});
 const replies=await response.json();if(!Array.isArray(replies))throw new Error('AUDIT_RECEIPTS: Invalid batch response');
 for(const request of requests){const matching=replies.filter(reply=>reply.id===request.id);if(matching.length!==1)throw new Error('AUDIT_RECEIPTS: Missing or duplicate reply');const reply=matching[0];if(reply.error||!reply.result)errors++;else if(reply.result.transactionHash.toLowerCase()!==request.params[0]!.toLowerCase())throw new Error('AUDIT_RECEIPTS: Wrong transaction receipt');else verified++;
  await writeFile(join(root,`receipt-${request.params[0]}.json`),JSON.stringify({provider,fetchedAt,request,reply}));
 }
}
const report={finishedAt:new Date().toISOString(),provider,transactions:hashes.length,verified,errors};await writeFile(join(root,'receipts-summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
