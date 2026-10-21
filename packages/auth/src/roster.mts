import type {Metadata} from '../../cases/src/build.mts';
import {detectiveFor,questionBudget} from '../../traits/src/detective.mts';
import {CareerStore,careerStatus} from '../../career/src/store.mts';
import {HolderDirectory} from './holders.mts';
import {AuthError} from './auth.mts';

export interface MetadataRecord {metadata:Metadata;uri:string;fetchedAt:string}
export class DetectiveRoster {
 constructor(private readonly options:{holders:HolderDirectory;career:CareerStore;metadata:ReadonlyMap<number,MetadataRecord>;now?:()=>number}){}
 async list(address:string,{after=0,limit=24}:{after?:number;limit?:number}={}){
  if(!Number.isSafeInteger(after)||after<0||after>1969||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AuthError('HOLDER_PAGE_INVALID','Choose a valid detective page.',400);
  const now=(this.options.now??Date.now)();if(!Number.isSafeInteger(now)||now<0)throw new AuthError('HOLDER_CLOCK_INVALID','The bureau time is unavailable.',503);
  const today=new Date(now).toISOString().slice(0,10),held=await this.options.holders.held(address);
  const page=held.filter(row=>row.tokenId>after).slice(0,limit),chogs=[];
  const sources:({kind:'TRANSFER';tx:string;block:number;logIndex:number}|{kind:'METADATA';uri:string;fetchedAt:string})[]=[];
  for(const row of page){
   const record=this.options.metadata.get(row.tokenId);
   if(!record||!record.uri||!Number.isFinite(Date.parse(record.fetchedAt)))throw new AuthError('HOLDER_METADATA_MISSING','A detective profile could not be checked.',503);
   const detective=detectiveFor(row.tokenId,record.metadata),career=await this.options.career.profile(row.tokenId);
   const firstCase=career.duties.length===0||career.duties.length===1&&career.duties[0]!.day===today;
   const budget=questionBudget({skill:detective.skill,heldSince:row.heldSince,now:Math.floor(now/1000),founder:row.founder,firstCase});
   chogs.push({...detective,budget,founder:row.founder,holdDays:Math.floor(budget.holdSeconds/86400),...careerStatus(career,today,row.founder),playedToday:career.duties.some(duty=>duty.day===today&&duty.result!==null),startedToday:career.duties.some(duty=>duty.day===today)});
   sources.push({kind:'TRANSFER',tx:row.arrival.tx,block:row.arrival.block,logIndex:row.arrival.logIndex},{kind:'METADATA',uri:record.uri,fetchedAt:record.fetchedAt});
  }
  const last=page.at(-1)?.tokenId;
  return {chogs,total:held.length,nextCursor:last!==undefined&&held.some(row=>row.tokenId>last)?last:null,sources};
 }
}
