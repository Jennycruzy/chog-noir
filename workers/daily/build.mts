import {keccak256,toBytes} from 'viem';
import type {EnrichedEvent} from '../../packages/core/src/enrich.mts';
import type {OwnerSnapshot} from '../../packages/auth/src/holders.mts';
import {buildLinkedCast,castQuality,type Metadata} from '../../packages/cases/src/build.mts';
import {saleCandidates,escrowCandidates,rankCandidates,type Candidate,type CaseRules} from '../../packages/cases/src/select.mts';
import {buildSalePuzzle,PuzzleError,type PuzzleCase} from '../../packages/cases/src/puzzle.mts';
import {catalogForPuzzle,selectClaimPuzzle,verifyComposedPuzzleSources} from '../../packages/cases/src/compose.mts';
import {ClaimSourceError,type BulkSource} from '../../packages/witness/src/claims.mts';

export interface DailySource {history:readonly EnrichedEvent[];times:ReadonlyMap<number,number>;metadata:ReadonlyMap<number,Metadata>;ownership:OwnerSnapshot;bulkSources:readonly BulkSource[];rules:CaseRules}
/** The event a published case was built from; used to avoid repeating a Chog or wallet within seven cases. */
export interface CaseEvent {sourceId:string;tokenId:number;from:string;to:string}
/** fallbackPool counts older real sales still eligible as cold cases: the reserve for quiet days. */
export interface DailyBuild {puzzle:PuzzleCase;source:'FRESH'|'COLD_FALLBACK';event:CaseEvent;rejected:{candidate:string;code:string}[];fallbackPool:number}
const eventOf=(candidate:Candidate):CaseEvent=>({sourceId:candidate.row.event.tx.toLowerCase()+':'+candidate.row.event.logIndex,tokenId:candidate.row.event.tokenId,from:candidate.row.event.from,to:candidate.row.event.to});

/**
 * Builds the shared case that opens at 00:20 UTC on `day`. Yesterday's real sales come first, ranked by the case score;
 * when none of them yields a fair, solvable case the builder takes a cold case from an older real sale that none of the
 * previous seven cases used. Nothing is invented: every candidate either passes every check or is skipped with its reason.
 */
export function buildDailyPuzzle(input:DailySource&{day:string;salt:string;previous:readonly CaseEvent[];optedOut?:ReadonlySet<string>;linkCoverage?:(cast:readonly number[])=>number}):DailyBuild{
 const {day,salt,history,times,metadata,ownership,bulkSources,rules}=input,start=Date.parse(day+'T00:00:00Z')/1000;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(start)||new Date(start*1000).toISOString().slice(0,10)!==day)throw new PuzzleError('CASE_DAY_INVALID','Choose a valid UTC case day.');
 const sourceDay=new Date((start-86400)*1000).toISOString().slice(0,10),recent=input.previous.slice(-7),rejected:DailyBuild['rejected']=[];
 const candidates=[...saleCandidates(history,times,rules),...escrowCandidates(history,times)],used=new Set<string>();
 const attempt=(candidate:Candidate)=>{
  const event=eventOf(candidate);if(used.has(event.sourceId))return null;used.add(event.sourceId);
  try{
   const source={candidate,history,times,metadata,day,salt,mode:'DAILY' as const},base=buildSalePuzzle(source);
   const catalog=catalogForPuzzle(base,{history,times,metadata,ownership,bulkSources}),{puzzle}=selectClaimPuzzle(base,catalog);
   if(!verifyComposedPuzzleSources(puzzle,source,catalog)){rejected.push({candidate:candidate.id,code:'CASE_SOURCE_REBUILD'});return null;}
   // An opted-out wallet must not appear as the sale's parties or as any witness's holder at the cutoff.
   if(input.optedOut?.size){
    const cutoff=puzzle.file.cutoff,holders=new Map<number,string>();
    for(const row of history)if(row.event.block<cutoff.block||row.event.block===cutoff.block&&row.event.logIndex<=cutoff.logIndex)if(row.event.from!==row.event.to)holders.set(row.event.tokenId,row.event.to.toLowerCase());
    const wallets=[event.from,event.to,...puzzle.file.cast.map(member=>holders.get(member.tokenId)??'')].map(wallet=>wallet.toLowerCase());
    if(wallets.some(wallet=>input.optedOut!.has(wallet))){rejected.push({candidate:candidate.id,code:'CASE_OPTED_OUT'});return null;}
   }
   return {puzzle,event};
  }catch(error){
   // Only expected case-building rejections move on to the next event; anything else is a fault.
   if(error instanceof PuzzleError||error instanceof ClaimSourceError){rejected.push({candidate:candidate.id,code:error.code});return null;}
   throw error;
  }
 };
 const fresh=rankCandidates(candidates,{day:sourceDay,previous:recent.map(row=>({tokenId:row.tokenId,wallets:[row.from,row.to]})),castQuality:candidate=>{const cast=buildLinkedCast(candidate,history,times,metadata);return cast.length?castQuality(cast.slice(0,4),metadata):0;},
  ...(input.linkCoverage?{linkCoverage:(candidate:Candidate)=>input.linkCoverage!(buildLinkedCast(candidate,history,times,metadata).slice(0,4).map(row=>row.tokenId))}:{})});
 // Cold case: an older real sale, in an order fixed by the day so the fallback is reproducible but varies day to day.
 const excluded=new Set(recent.flatMap(row=>[String(row.tokenId),row.from.toLowerCase(),row.to.toLowerCase(),row.sourceId]));
 const cold=candidates.filter(candidate=>candidate.at<start-86400&&!excluded.has(eventOf(candidate).sourceId)&&!excluded.has(String(candidate.row.event.tokenId))&&!excluded.has(candidate.row.event.from.toLowerCase())&&!excluded.has(candidate.row.event.to.toLowerCase()))
  .sort((a,b)=>keccak256(toBytes(day+':'+a.id)).localeCompare(keccak256(toBytes(day+':'+b.id))));
 const fallbackPool=new Set(cold.map(candidate=>eventOf(candidate).sourceId)).size;
 for(const {candidate} of fresh){const built=attempt(candidate);if(built)return {...built,source:'FRESH',rejected,fallbackPool};}
 for(const candidate of cold){const built=attempt(candidate);if(built)return {...built,source:'COLD_FALLBACK',rejected,fallbackPool};}
 throw new PuzzleError('CASE_UNSOLVABLE','No real event produced a fair, solvable case for this day.');
}
