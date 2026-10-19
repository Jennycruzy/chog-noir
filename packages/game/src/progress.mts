import {keccak256,toBytes} from 'viem';
import type {CaseDraft} from '../../cases/src/build.mts';
import type {Partner,Session} from './session.mts';
export interface CaseResult {caseId:string;type:string;subject:string;score:number;grade:string;finishedAt:string;kind:'ARCHIVE'|'MAIN'|'COLD';day:string|null;lieCaught:boolean}
export interface Player {
 v:1;createdAt:string;starters:number[];unlocked:number[];sessions:Record<string,string>;sessionIds?:string[];results:CaseResult[];pending?:{caseId:string;submittedAt:string;sessionId?:string}[];
 streak:number;alibis:number;lastDaily:string|null;freezesEarned:number;
}
export function createPlayer(seed:string,partners:readonly Partner[]):Player{
 const starters=['XRAY','ANALYST','EMPATH'].map(power=>{
  const pool=partners.filter(item=>item.power===power).sort((a,b)=>a.tokenId-b.tokenId);
  if(!pool.length)throw new Error('PLAYER_STARTERS: Missing partner group');
  const number=BigInt(keccak256(toBytes(`${seed}:${power}`)));
  return pool[Number(number%BigInt(pool.length))]!.tokenId;
 });
 return {v:1,createdAt:new Date().toISOString(),starters,unlocked:[...starters],sessions:{},sessionIds:[],results:[],streak:0,alibis:0,lastDaily:null,freezesEarned:0};
}
export function recordResult(player:Player,draft:CaseDraft,session:Session,result:{score:number;grade:string;questions:{id:string;correct:boolean}[]},kind:CaseResult['kind']='ARCHIVE',day:string|null=null,now=new Date()){
 if(!session.submitted)throw new Error('PLAYER_RESULT: Session must be closed');
 const next=structuredClone(player),existing=next.results.find(item=>item.caseId===draft.public.id);
 if(!existing)next.results.unshift({caseId:draft.public.id,type:draft.public.type,subject:draft.public.subject.name,score:result.score,grade:result.grade,finishedAt:now.toISOString(),kind,day,lieCaught:session.caught});
 if(existing&&!(kind==='ARCHIVE'&&existing.kind!=='ARCHIVE')&&result.score>existing.score){existing.score=result.score;existing.grade=result.grade;existing.lieCaught=session.caught;existing.finishedAt=now.toISOString();}
 const unlocked=new Set(next.unlocked);
 if(session.caught)unlocked.add(draft.private.key.lie.witness);
 const answeredChog=result.questions.some(question=>question.id==='chog'&&question.correct);
 if(answeredChog&&session.asked.includes(draft.public.subject.tokenId))unlocked.add(draft.public.subject.tokenId);
 for(const question of result.questions)if(question.id==='price'&&question.correct){
  for(const played of session.askedCards??[])if(['LAST_SALE','PRICE_TALK'].includes(played.card)&&played.tokenId===draft.public.subject.tokenId)unlocked.add(played.tokenId);
 }
 next.unlocked=[...unlocked].sort((a,b)=>a-b);
 if(!existing&&kind==='MAIN'&&day)creditDaily(next,day);
 next.pending=(next.pending??[]).filter(item=>item.caseId!==draft.public.id);
 return next;
}
function creditDaily(next:Player,day:string){
 if(next.lastDaily!==day){
  const previous=next.lastDaily?Date.parse(next.lastDaily+'T00:00:00Z'):null,current=Date.parse(day+'T00:00:00Z');
  if(previous!==null&&current<previous)return;
  const gap=previous===null?1:Math.round((current-previous)/86400000);
  const missed=Math.max(0,gap-1);
  if(previous===null||missed>next.alibis)next.streak=1;
  else{next.alibis-=missed;next.streak++;}
  next.lastDaily=day;
  if(next.streak%7===0){next.alibis=Math.min(2,next.alibis+1);next.freezesEarned++;}
 }
}
export function recordPending(player:Player,draft:CaseDraft,now=new Date(),sessionId?:string){
 const next=structuredClone(player);next.pending??=[];
 if(next.pending.some(item=>item.caseId===draft.public.id)||next.results.some(item=>item.caseId===draft.public.id))return next;
 next.pending.push({caseId:draft.public.id,submittedAt:now.toISOString(),...(sessionId?{sessionId}:{})});
 const publication=draft.public.publication;
 if(publication?.kind==='MAIN')creditDaily(next,publication.day);
 return next;
}
export function playerSummary(player:Player,partners:readonly Partner[],today=new Date().toISOString().slice(0,10)){
 const solved=player.results.filter(item=>['A','B','C'].includes(item.grade)).length;
 const rank=solved>=50?'Chief':solved>=25?'Inspector':solved>=10?'Detective':solved>=3?'Gumshoe':'Rookie';
 const days=player.lastDaily?Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(player.lastDaily+'T00:00:00Z'))/86400000):0;
 return {pending:(player.pending??[]).map(({caseId,submittedAt})=>({caseId,submittedAt})),createdAt:player.createdAt,starters:player.starters,unlocked:player.unlocked,partners:partners.filter(item=>player.unlocked.includes(item.tokenId)),results:player.results,solved,rank,streak:days>1+player.alibis?0:player.streak,alibis:player.alibis,lastDaily:player.lastDaily};
}
