import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ownerDirectory,type OwnerSnapshot} from '../../auth/src/holders.mts';
import {decodeTransfer} from '../../core/src/chain.mts';
import {withPlayerLock} from '../../game/src/player-lock.mts';
import {atomicJSON} from '../../publishing/src/vault.mts';
import {recoverTransfers,type RecoveryPage} from './recovery.mts';

export interface OwnerBlock {number:number;timestamp:number;hash:string}
export interface OwnerSource {
 chainId:()=>Promise<number>;finalized:()=>Promise<OwnerBlock>;block:(number:number)=>Promise<OwnerBlock>;
 page:(from:number,toExclusive:number)=>Promise<RecoveryPage>;
}
export interface FreshOwnerSnapshot extends OwnerSnapshot {v:1;indexedHash:string;checkedAt:number}
interface Base {v:1;fromBlock:number;seed:OwnerSnapshot|null;hash:string|null}
const firstMintBlock=101704044;
const safe=(value:number)=>Number.isSafeInteger(value)&&value>=0;
function blockValid(block:OwnerBlock,expected?:number){
 if(!safe(block.number)||!safe(block.timestamp)||!/^0x[a-f0-9]{64}$/i.test(block.hash)||expected!==undefined&&block.number!==expected)throw new Error('OWNER_SOURCE_BLOCK: Invalid source block');
 return block;
}
async function optional<T>(path:string):Promise<T|null>{try{return JSON.parse(await readFile(path,'utf8')) as T;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}

export function ownerIndexer(options:{root:string;source:OwnerSource;now?:()=>number}){
 const directory=join(options.root,'runs/owners'),source=options.source,now=options.now??Date.now;
 // Facts this process already established: the chain, the snapshot it wrote last, and the validated import seed.
 let chainChecked=false,written:string|null=null,seedChecked:string|null=null;
 const identity=(snapshot:FreshOwnerSnapshot)=>snapshot.indexedHash+':'+snapshot.checkedAt+':'+snapshot.transfers.length;
 return {
  async refresh(seed?:OwnerSnapshot):Promise<FreshOwnerSnapshot>{
   return withPlayerLock(options.root,createHash('sha256').update('owner-index').digest('hex'),async()=>{
    if(!chainChecked){if(await source.chainId()!==143)throw new Error('OWNER_SOURCE_CHAIN: Monad mainnet required');chainChecked=true;}
    const head=blockValid(await source.finalized()),started=now();
    if(!safe(started)||head.timestamp*1000>started+5000||started-head.timestamp*1000>=60_000)throw new Error('OWNER_SOURCE_STALE: Finalized head is stale or in the future');
    await mkdir(join(directory,'blocks'),{recursive:true,mode:0o700});
    const previous=await optional<FreshOwnerSnapshot>(join(directory,'snapshot.json'));
    if(previous){
     if(identity(previous)!==written)ownerDirectory(previous);
     if(previous.v!==1||!/^0x[a-f0-9]{64}$/i.test(previous.indexedHash)||!safe(previous.checkedAt))throw new Error('OWNER_INDEX_STATE: Invalid saved snapshot');
     if(head.number<previous.indexedBlock)throw new Error('OWNER_SOURCE_BEHIND: Source is behind saved history');
     const canonical=blockValid(await source.block(previous.indexedBlock),previous.indexedBlock);
     if(canonical.hash.toLowerCase()!==previous.indexedHash.toLowerCase())throw new Error('OWNER_SOURCE_REORG: Saved finalized block changed');
    }
    let base=await optional<Base>(join(directory,'base.json'));
    if(!base){
     if(seed){
      ownerDirectory(seed);
      if(seed.indexedBlock>head.number)throw new Error('OWNER_SEED_AHEAD: Source is behind imported history');
      const anchor=blockValid(await source.block(seed.indexedBlock),seed.indexedBlock);
      if(seed.indexedAt<anchor.timestamp*1000)throw new Error('OWNER_SEED_TIME: Imported history predates its block');
      base={v:1,fromBlock:seed.indexedBlock+1,seed:structuredClone(seed),hash:anchor.hash};
     }else base={v:1,fromBlock:firstMintBlock,seed:null,hash:null};
     await atomicJSON(join(directory,'base.json'),base);
    }
    if(base.v!==1||!safe(base.fromBlock)||base.fromBlock<firstMintBlock||base.fromBlock>head.number+1||base.seed===null&&base.fromBlock!==firstMintBlock)throw new Error('OWNER_INDEX_STATE: Invalid history start');
    if(base.seed){
     if(seedChecked!==base.hash){ownerDirectory(base.seed);seedChecked=base.hash;}
     if(base.fromBlock!==base.seed.indexedBlock+1||!base.hash)throw new Error('OWNER_INDEX_STATE: Imported history anchor is missing');
     const anchor=blockValid(await source.block(base.seed.indexedBlock),base.seed.indexedBlock);
     if(anchor.hash.toLowerCase()!==base.hash.toLowerCase())throw new Error('OWNER_SOURCE_REORG: Imported finalized block changed');
    }
    const recovered=await recoverTransfers({directory:join(directory,'history'),fromBlock:base.fromBlock,toBlock:head.number+1,fetchPage:source.page});
    const transfers=[...(base.seed?.transfers??[]),...recovered.logs.map(decodeTransfer)];
    const times=new Map(base.seed?.blockTimes??[]);
    for(const number of new Set(transfers.map(row=>row.block))){
     if(times.has(number))continue;
     const path=join(directory,'blocks',number+'.json');
     let block=await optional<OwnerBlock>(path);
     if(block)blockValid(block,number);
     else{block=blockValid(await source.block(number),number);await atomicJSON(path,block);}
     times.set(number,block.timestamp);
    }
    const confirmed=blockValid(await source.block(head.number),head.number);
    if(confirmed.hash.toLowerCase()!==head.hash.toLowerCase())throw new Error('OWNER_SOURCE_REORG: Finalized head changed during indexing');
    const checkedAt=now();
    if(!safe(checkedAt)||checkedAt<started||checkedAt-head.timestamp*1000>=60_000)throw new Error('OWNER_SOURCE_STALE: Catch-up finished behind the current head; retry');
    const snapshot:FreshOwnerSnapshot={v:1,chainId:143,indexedBlock:head.number,indexedHash:head.hash,indexedAt:Math.min(checkedAt,head.timestamp*1000),checkedAt,transfers,blockTimes:[...times].sort(([a],[b])=>a-b)};
    ownerDirectory(snapshot);await atomicJSON(join(directory,'snapshot.json'),snapshot);written=identity(snapshot);return snapshot;
   },5);
  },
 };
}
