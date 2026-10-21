import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test,expect,vi} from 'vitest';
import {ownerIndexer,type OwnerSource,type OwnerBlock} from '../src/owners.mts';
import type {OwnerSnapshot} from '../../auth/src/holders.mts';
import {ownerDirectory} from '../../auth/src/holders.mts';
import {CHOG,TRANSFER_TOPIC,type ChainLog,type Transfer} from '../../core/src/chain.mts';

const fixture=JSON.parse(readFileSync(new URL('../../auth/test/fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot};
const header=JSON.parse(readFileSync(new URL('./fixtures/owner-head.json',import.meta.url),'utf8')).reply.result;
const headers=JSON.parse(readFileSync(new URL('./fixtures/owner-tail-blocks.json',import.meta.url),'utf8')).replies.map((r:{result:typeof header})=>r.result) as typeof header[];
const normalize=(raw:typeof header):OwnerBlock=>({number:Number(BigInt(raw.number)),timestamp:Number(BigInt(raw.timestamp)),hash:raw.hash});
const head=normalize(header),seedHead=normalize(headers[0]);
const seed:OwnerSnapshot={...fixture.snapshot,indexedBlock:seedHead.number,indexedAt:seedHead.timestamp*1000,transfers:fixture.snapshot.transfers.filter(row=>row.block<=seedHead.number),blockTimes:fixture.snapshot.blockTimes.filter(([block])=>block<=seedHead.number)};
const tail=fixture.snapshot.transfers.filter(row=>row.block>seedHead.number);
const log=(row:Transfer):ChainLog=>({address:CHOG,topics:[TRANSFER_TOPIC,'0x'+row.from.slice(2).padStart(64,'0'),'0x'+row.to.slice(2).padStart(64,'0'),'0x'+row.tokenId.toString(16).padStart(64,'0')],data:'0x',transactionHash:row.tx,blockNumber:row.block,logIndex:row.logIndex});
function source():OwnerSource{
 const blocks=new Map([header,...headers].map(raw=>{const row=normalize(raw);return [row.number,row];}));
 return {chainId:async()=>143,finalized:async()=>head,block:async number=>{const row=blocks.get(number);if(!row)throw new Error('Missing captured header');return row;},
  page:vi.fn(async(from,to)=>({fetchedAt:new Date(head.timestamp*1000).toISOString(),query:{fromBlock:from,toBlock:to},reply:{nextBlock:to,data:{logs:tail.filter(row=>row.block>=from&&row.block<to).map(log)}}}))};
}
async function sandbox(action:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'chog-owners-'));try{await action(root);}finally{await rm(root,{recursive:true,force:true});}}
test('real tail transfers update owners and a restart reuses contiguous saved history',async()=>sandbox(async root=>{
 const provider=source(),now=()=>head.timestamp*1000+10_000;
 const snapshot=await ownerIndexer({root,source:provider,now}).refresh(seed);
 expect(snapshot.transfers).toEqual(fixture.snapshot.transfers);
 expect(ownerDirectory(snapshot)).toEqual(ownerDirectory(fixture.snapshot));
 expect(snapshot.indexedAt).toBe(head.timestamp*1000);
 expect(provider.page).toHaveBeenCalledTimes(1);
 expect(await ownerIndexer({root,source:provider,now}).refresh()).toEqual(snapshot);
 expect(provider.page).toHaveBeenCalledTimes(1);
}));
test('a frozen head cannot be relabelled fresh',async()=>sandbox(async root=>{
 const provider=source();let now=head.timestamp*1000+10_000;
 const indexer=ownerIndexer({root,source:provider,now:()=>now});await indexer.refresh(seed);
 const path=join(root,'runs/owners/snapshot.json'),before=await readFile(path,'utf8');
 now=head.timestamp*1000+60_000;
 await expect(indexer.refresh()).rejects.toThrow('OWNER_SOURCE_STALE');
 expect(await readFile(path,'utf8')).toBe(before);
}));
test('changed canonical block and wrong chain leave the last good snapshot intact',async()=>sandbox(async root=>{
 const provider=source(),now=()=>head.timestamp*1000+10_000;
 await ownerIndexer({root,source:provider,now}).refresh(seed);
 const path=join(root,'runs/owners/snapshot.json'),before=await readFile(path,'utf8');
 const wrongHash={...provider,block:async(number:number)=>({...await provider.block(number),hash:header.parentHash})};
 await expect(ownerIndexer({root,source:wrongHash,now}).refresh()).rejects.toThrow('OWNER_SOURCE_REORG');
 await expect(ownerIndexer({root,source:{...provider,chainId:async()=>10143},now}).refresh()).rejects.toThrow('OWNER_SOURCE_CHAIN');
 expect(await readFile(path,'utf8')).toBe(before);
}));
test('catch-up after a source failure retries the missing page and publishes only a complete snapshot',async()=>sandbox(async root=>{
 const provider=source(),page=provider.page;
 provider.page=vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockImplementation(page);
 const indexer=ownerIndexer({root,source:provider,now:()=>head.timestamp*1000+10_000});
 await expect(indexer.refresh(seed)).rejects.toThrow('Connection lost');
 await expect(readFile(join(root,'runs/owners/snapshot.json'))).rejects.toMatchObject({code:'ENOENT'});
 expect((await indexer.refresh()).transfers).toEqual(fixture.snapshot.transfers);
 expect(provider.page).toHaveBeenCalledTimes(2);
}));
