import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const directory=resolve(process.argv[2]??'runs/wallet-audit-20261017');
const seen=new Set<string>(),tokens=new Map<string,number>();
for(const file of await readdir(directory)){
 if(!/^[0-9a-f]{64}\.json$/.test(file))continue;
 const page=JSON.parse(await readFile(join(directory,file),'utf8'));
 if(!page.query.fieldSelection.transaction?.includes('Input'))continue;
 for(const log of page.reply.data.logs){
  const topics=[...log.topics];while(topics.length&&topics.at(-1)==null)topics.pop();
  if(topics.length!==3||!/^0x[0-9a-f]{64}$/i.test(log.data??''))continue;
  const key=`${log.transactionHash}:${log.logIndex}`;if(seen.has(key))continue;seen.add(key);
  const token=log.address.toLowerCase();tokens.set(token,(tokens.get(token)??0)+1);
 }
}
const records=[];
for(const[address,count]of tokens){
 const request={jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:address,data:'0x95d89b41'},'latest']};
 const fetchedAt=new Date().toISOString();
 let reply;
 try{const response=await fetch('https://rpc.monad.xyz',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});reply=await response.json();}catch{reply={error:'Token symbol unavailable'};}
 records.push({address,count,fetchedAt,request,reply});
}
await writeFile(join(directory,'all-token-symbols.json'),JSON.stringify(records));
console.log(JSON.stringify({tokens:tokens.size,erc20Transfers:seen.size,symbolReplies:records.length},null,2));
