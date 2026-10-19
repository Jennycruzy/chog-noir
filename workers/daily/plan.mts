import type {CaseDraft} from '../../packages/cases/src/build.mts';
export interface SavedPlan {
 day:string;cases:{id:string;kind:'MAIN'|'COLD';source:'FRESH'|'COLD_FALLBACK';sourceCaseId?:string}[];
}
export function sourceCaseId(draft:CaseDraft):string{
 const source=draft.public.ledger.find(fact=>fact.id==='subject')?.sources[0];
 if(!source)throw new Error('DAILY_SOURCE_ID: Case has no source event');
 return `${source.tx.toLowerCase()}:${source.logIndex}:${draft.public.subject.tokenId}`;
}
export async function recoverDailySource<T extends {coverageAt:number}>(collect:()=>Promise<T>,saved:()=>Promise<T>,day:string,clock=()=>Date.now()){
 const midnight=Date.parse(day+'T00:00:00Z');
 try{
  const data=await collect();
  if(data.coverageAt<midnight/1000)throw new Error('DAILY_COVERAGE: Source does not cover the completed UTC day');
  return {data,fresh:true,degraded:false,reason:null};
 }catch(error){
  if(clock()<midnight+10*60_000)throw new Error('DAILY_SOURCE_WAIT: Retry the source until 00:10 UTC',{cause:error});
  return {data:await saved(),fresh:false,degraded:true,reason:error instanceof Error?error.message:'Daily source unavailable'};
 }
}
export function chooseFallbacks(day:string,pool:readonly CaseDraft[],previous:readonly SavedPlan[],fresh:CaseDraft|null=null){
 // Two daily slots plus seven complete prior plans need sixteen distinct events.
 const unique=[...new Map(pool.map(draft=>[sourceCaseId(draft),draft])).values()];
 if(unique.length<16)throw new Error('DAILY_POOL_CAPACITY: At least sixteen distinct source cases are required');
 const current=Date.parse(day+'T00:00:00Z')/86400000;
 const used=new Set(previous.filter(plan=>{const days=current-Date.parse(plan.day+'T00:00:00Z')/86400000;return days>=1&&days<=7;}).flatMap(plan=>plan.cases.map(item=>item.sourceCaseId).filter((id):id is string=>!!id)));
 const rotated=Array.from({length:unique.length},(_,index)=>unique[(2*current+index)%unique.length]!);
 const main=rotated.find(draft=>!used.has(sourceCaseId(draft)));
 if(!main)throw new Error('DAILY_POOL_EXHAUSTED: No unused MAIN source case');
 const mainId=sourceCaseId(fresh??main);
 const available=rotated.filter(draft=>!used.has(sourceCaseId(draft))&&sourceCaseId(draft)!==mainId);
 const cold=available[0];
 if(!cold)throw new Error('DAILY_POOL_EXHAUSTED: No distinct unused COLD source case');
 return {main,cold};
}

export async function sourceBefore<T,>(request:()=>Promise<T>,deadline:number):Promise<T>{
 const remaining=deadline-Date.now();if(remaining<=0)throw new Error('DAILY_SOURCE_TIMEOUT: Source build deadline elapsed');
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([request(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DAILY_SOURCE_TIMEOUT: Source build deadline elapsed')),remaining);})]);}
 finally{if(timer)clearTimeout(timer);}
}
export function dailySources(day:string,pool:readonly CaseDraft[],previous:readonly SavedPlan[],chosen:CaseDraft|null){
 const fallback=chooseFallbacks(day,pool,previous,chosen);
 return [{draft:chosen??fallback.main,kind:'MAIN' as const,source:chosen?'FRESH' as const:'COLD_FALLBACK' as const},{draft:fallback.cold,kind:'COLD' as const,source:'COLD_FALLBACK' as const}];
}
