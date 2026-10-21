import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import {rpcOwnerSource} from '../src/owner-source.mts';
import {CHOG,TRANSFER_TOPIC} from '../../core/src/chain.mts';
const captured=JSON.parse(readFileSync(new URL('./fixtures/owner-head.json',import.meta.url),'utf8'));
test('the read-only RPC source filters Chog transfers and caps ranges at ten thousand blocks',async()=>{
 const requests:{method:string;params:any[];id:number}[]=[];
 const fetcher:typeof fetch=async(_url,init)=>{
  const request=JSON.parse(String(init?.body));requests.push(request);
  expect(new Headers(init?.headers).get('user-agent')).toBe('ChogNoir/1.0');
  return Response.json({jsonrpc:'2.0',id:request.id,result:request.method==='eth_getBlockByNumber'?captured.reply.result:[]});
 };
 const source=rpcOwnerSource(captured.rpc,fetcher),head=await source.finalized();
 expect(head.hash).toBe(captured.reply.result.hash);
 const result=await source.page(head.number+1,head.number+30_001);
 expect(result.reply.nextBlock).toBe(head.number+10_001);
 expect(requests[1]?.params[0]).toEqual({address:CHOG,topics:[TRANSFER_TOPIC],fromBlock:'0x'+(head.number+1).toString(16),toBlock:'0x'+(head.number+10_000).toString(16)});
 expect(requests.every(request=>['eth_getBlockByNumber','eth_getLogs'].includes(request.method))).toBe(true);
});
test('mismatched replies, provider errors and unsafe quantities fail loudly',async()=>{
 for(const reply of [{jsonrpc:'2.0',id:999,result:'0x8f'},{jsonrpc:'2.0',id:1,error:{message:'unavailable'}},{jsonrpc:'2.0',id:1,result:'0xffffffffffffffffffff'}]){
  const source=rpcOwnerSource(captured.rpc,async()=>Response.json(reply));await expect(source.chainId()).rejects.toThrow('OWNER_RPC_');
 }
});
