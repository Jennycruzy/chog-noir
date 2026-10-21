import {CHOG,TRANSFER_TOPIC,type ChainLog} from '../../core/src/chain.mts';
import type {OwnerSource,OwnerBlock} from './owners.mts';

function integer(value:unknown){if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))throw new Error('OWNER_RPC_NUMBER: Invalid RPC quantity');const number=Number(BigInt(value));if(!Number.isSafeInteger(number)||number<0)throw new Error('OWNER_RPC_NUMBER: Invalid RPC quantity');return number;}
const quantity=(number:number)=>'0x'+number.toString(16);
export function rpcOwnerSource(url:string,fetcher:typeof fetch=fetch):OwnerSource{
 const endpoint=new URL(url);if(!['http:','https:'].includes(endpoint.protocol))throw new Error('OWNER_RPC_URL: Invalid RPC endpoint');
 let id=0;
 async function rpc(method:string,params:unknown[]):Promise<unknown>{
  const requestId=++id;
  const response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json','user-agent':'ChogNoir/1.0'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw new Error('OWNER_RPC_HTTP: Source request failed');
  const reply=await response.json() as {id:unknown;jsonrpc:unknown;error?:unknown;result?:unknown};
  if(reply.jsonrpc!=='2.0'||reply.id!==requestId||reply.error||reply.result===undefined||reply.result===null)throw new Error('OWNER_RPC_REPLY: Source returned an invalid result');
  return reply.result;
 }
 const block=async(tag:string):Promise<OwnerBlock>=>{
  const raw=await rpc('eth_getBlockByNumber',[tag,false]) as {number:unknown;timestamp:unknown;hash:unknown};
  if(typeof raw.hash!=='string'||!/^0x[a-f0-9]{64}$/i.test(raw.hash))throw new Error('OWNER_RPC_BLOCK: Invalid block hash');
  return {number:integer(raw.number),timestamp:integer(raw.timestamp),hash:raw.hash.toLowerCase()};
 };
 return {
  chainId:async()=>integer(await rpc('eth_chainId',[])),finalized:()=>block('finalized'),block:(number)=>block(quantity(number)),
  async page(from,toExclusive){
   if(!Number.isSafeInteger(from)||from<0||!Number.isSafeInteger(toExclusive)||toExclusive<=from)throw new Error('OWNER_RPC_RANGE: Invalid block range');
   const end=Math.min(toExclusive,from+10_000),fetchedAt=new Date().toISOString();
   const raw=await rpc('eth_getLogs',[{address:CHOG,topics:[TRANSFER_TOPIC],fromBlock:quantity(from),toBlock:quantity(end-1)}]);
   if(!Array.isArray(raw))throw new Error('OWNER_RPC_LOGS: Source returned no log array');
   const logs:ChainLog[]=raw.map(log=>({address:log.address,topics:log.topics,data:log.data,transactionHash:log.transactionHash,blockNumber:integer(log.blockNumber),logIndex:integer(log.logIndex),...(log.removed===true?{removed:true}:{})}));
   return {fetchedAt,query:{fromBlock:from,toBlock:toExclusive},reply:{nextBlock:end,data:{logs}}};
  },
 };
}
