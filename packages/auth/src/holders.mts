import {getAddress,type Address} from 'viem';
import {buildOwnership} from '../../core/src/owners.mts';
import {ZERO,type Transfer} from '../../core/src/chain.mts';
import {AuthError} from './auth.mts';

export interface OwnerSnapshot {
 chainId:143;indexedBlock:number;indexedAt:number;transfers:Transfer[];blockTimes:[number,number][];
}
export interface HeldChog {
 tokenId:number;owner:Address;heldSince:number;founder:boolean;arrival:Transfer;mint:Transfer;
}
const tokenValid=(id:number)=>Number.isSafeInteger(id)&&id>=1&&id<=1969;
const timeValid=(value:number)=>Number.isSafeInteger(value)&&value>=0;
export function ownerDirectory(snapshot:OwnerSnapshot):Map<number,HeldChog>{
 if(snapshot.chainId!==143||!timeValid(snapshot.indexedBlock)||!timeValid(snapshot.indexedAt))throw new AuthError('HOLDER_INDEX_INVALID','Chog ownership data is invalid.',503);
 const times=new Map(snapshot.blockTimes);
 if(times.size!==snapshot.blockTimes.length||[...times].some(([block,time])=>!timeValid(block)||!timeValid(time)||block>snapshot.indexedBlock||time*1000>snapshot.indexedAt))throw new AuthError('HOLDER_INDEX_INVALID','Chog ownership times are invalid.',503);
 const mints=new Map<number,Transfer>();
 const movements=new Set<number>();
 const transfers=snapshot.transfers.map(row=>{
  if(!tokenValid(row.tokenId)||!timeValid(row.block)||row.block>snapshot.indexedBlock||!timeValid(row.logIndex)||!/^0x[a-f0-9]{64}$/i.test(row.tx))throw new AuthError('HOLDER_INDEX_INVALID','Chog ownership sources are invalid.',503);
  let from:Address,to:Address;try{from=getAddress(row.from);to=getAddress(row.to);}catch{throw new AuthError('HOLDER_INDEX_INVALID','Chog ownership addresses are invalid.',503);}
  const normalized={...row,tx:row.tx.toLowerCase(),from:from.toLowerCase(),to:to.toLowerCase()};
  if(normalized.from===ZERO){if(mints.has(row.tokenId))throw new AuthError('HOLDER_INDEX_INVALID','Chog mint history is repeated.',503);mints.set(row.tokenId,normalized);}
  else if(normalized.from!==normalized.to)movements.add(row.tokenId);
  return normalized;
 });
 if(mints.size!==1969)throw new AuthError('HOLDER_INDEX_INCOMPLETE','Chog ownership history is incomplete.',503);
 let history;try{history=buildOwnership(transfers,times);}catch{throw new AuthError('HOLDER_INDEX_INVALID','Chog ownership history has a gap.',503);}
 const owners=new Map<number,HeldChog>();
 for(const row of history)if(row.departure===null){
  const mint=mints.get(row.tokenId)!;
  owners.set(row.tokenId,{tokenId:row.tokenId,owner:getAddress(row.owner),heldSince:Date.parse(row.arrivedAt)/1000,founder:!movements.has(row.tokenId)&&mint.to===row.owner,arrival:row.arrival,mint});
 }
 return owners;
}
export class HolderDirectory {
 private cached:{snapshot:OwnerSnapshot;directory:Map<number,HeldChog>}|undefined;
 constructor(private readonly options:{snapshot:()=>Promise<OwnerSnapshot>;ownerOf:(tokenId:number)=>Promise<string>;now?:()=>number}){}
 private async fresh(){
  let snapshot:OwnerSnapshot;try{snapshot=await this.options.snapshot();}catch{throw new AuthError('HOLDER_INDEX_UNAVAILABLE','Chog ownership is unavailable. Try again.',503);}
  const now=(this.options.now??Date.now)();
  if(!timeValid(now)||!timeValid(snapshot.indexedAt)||now<snapshot.indexedAt||now-snapshot.indexedAt>=60_000)throw new AuthError('HOLDER_INDEX_STALE','Chog ownership is updating. Try again.',503);
  const cached=this.cached;if(cached&&cached.snapshot===snapshot)return cached.directory;
  const directory=ownerDirectory(snapshot);this.cached={snapshot,directory};return directory;
 }
 async held(address:string){
  let owner:Address;try{owner=getAddress(address);}catch{throw new AuthError('AUTH_ADDRESS_INVALID','Connect a valid wallet.',400);}
  return [...(await this.fresh()).values()].filter(row=>row.owner===owner).sort((a,b)=>a.tokenId-b.tokenId).map(row=>structuredClone(row));
 }
 async token(tokenId:number){
  if(!tokenValid(tokenId))throw new AuthError('HOLDER_TOKEN_INVALID','Choose a Chog from the collection.',400);
  const row=(await this.fresh()).get(tokenId);if(!row)throw new AuthError('HOLDER_INDEX_INVALID','Chog ownership data is invalid.',503);return structuredClone(row);
 }
 async owns(address:string,tokenId:number){
  if(!tokenValid(tokenId))throw new AuthError('HOLDER_TOKEN_INVALID','Choose a Chog from the collection.',400);
  let expected:Address;try{expected=getAddress(address);}catch{throw new AuthError('AUTH_ADDRESS_INVALID','Connect a valid wallet.',400);}
  try{return getAddress(await this.options.ownerOf(tokenId))===expected;}
  catch{throw new AuthError('HOLDER_RPC_UNAVAILABLE','Chog ownership could not be checked. Try again.',503);}
 }
 async start(address:string,tokenId:number){
  const held=await this.held(address);
  if(held.length===0)throw new AuthError('HOLDER_NO_CHOG','The bureau only hires Chogs.',403);
  const chog=held.find(row=>row.tokenId===tokenId);
  if(!chog||!await this.owns(address,tokenId))throw new AuthError('HOLDER_NOT_OWNER',"This Chog isn't in your wallet any more.",403);
  return chog;
 }
 async submission(address:string,tokenId:number){return {transferredMidCase:!await this.owns(address,tokenId)};}
}
