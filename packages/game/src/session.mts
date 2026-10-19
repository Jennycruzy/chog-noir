import type {CaseDraft, Metadata} from '../../cases/src/build.mts';
import {cards} from '../../witness/src/lines.mts';
import {memoryLine,type Card} from '../../witness/src/facts.mts';
import {traitsFor,type EyesPower} from '../../traits/src/traits.mts';

export type Power = EyesPower;
export interface Partner {tokenId:number;name:string;power:Power;description:string;uses?:number;special?:boolean;moneyTalk?:boolean;side?:'BUYER'|'SELLER'}
export interface Session {
 v:1;caseId:string;partner:Partner;revision:number;plays:number;initialPlays:number;
 asked:number[];opened:string[];unsealed:string[];accused:number[];caught:boolean;powerUsed:boolean;
 submitted:Record<string,string>|null;createdAt:string;practice?:boolean;submittedAt?:string;askedCards?:{tokenId:number;card:Card}[];exactCards?:number[];powerUses?:number;sideUsed?:boolean;identified?:number|null;
}
export class GameError extends Error {
 constructor(public status:number,message:string){super(message);}
}
function fail(message:string):never{throw new GameError(400,message);}
export function starterPartners(metadata:ReadonlyMap<number,Metadata>):Partner[]{
 const groups=new Map<Power,Partner>();
 for(const [tokenId,item] of [...metadata].sort(([a],[b])=>a-b)){
  const partner=traitsFor(tokenId,item);
  if(!groups.has(partner.power))groups.set(partner.power,partner);
 }
 if(!['XRAY','ANALYST','EMPATH'].every(power=>groups.has(power as Power)))throw new Error('GAME_PARTNERS: Missing source-backed starter group');
 return ['XRAY','ANALYST','EMPATH'].map(power=>groups.get(power as Power)!);
}
export function createSession(draft:CaseDraft,partner:Partner):Session{
 const initialPlays=8+(partner.power==='EMPATH'?2:0)+(partner.special?1:0);
 return {v:1,practice:!!draft.public.publication?.closed,caseId:draft.public.id,partner:structuredClone(partner),revision:0,plays:initialPlays,initialPlays,asked:[],opened:[],unsealed:[],accused:[],caught:false,powerUsed:partner.power==='EMPATH',submitted:null,createdAt:new Date().toISOString(),askedCards:[],exactCards:[],powerUses:partner.power==='EMPATH'?0:(partner.uses??1),sideUsed:false,identified:null};
}
export function play(draft:CaseDraft,session:Session,action:Record<string,unknown>):Session{
 if(session.caseId!==draft.public.id)throw new Error('GAME_CASE: Session does not match archive');
 if(action.revision!==session.revision)throw new GameError(409,'The case changed. Your latest progress has been restored; try again.');
 if(session.submitted)fail('This case is already closed.');
 if(draft.public.publication&&!session.practice&&Date.now()/1000>=draft.public.publication.closesAt)throw new GameError(403,'Daily play has closed. Wait for the reveal, then restart as archive practice.');
 const next=structuredClone(session),pub=draft.public;
 next.askedCards??=next.asked.map(tokenId=>({tokenId,card:'ARRIVAL' as const}));next.exactCards??=[];next.powerUses??=next.powerUsed?0:(next.partner.uses??1);next.sideUsed??=false;
 const spend=(cost:number)=>{if(next.plays<cost)fail('You do not have enough card plays. You can still answer the case.');next.plays-=cost;};
 switch(action.type){
  case 'ask':{
   const witness=pub.cast.find(member=>member.tokenId===action.tokenId);
   if(!witness)fail('Choose a witness in this case.');
   const card=(action.card??'ARRIVAL') as Card;
   if(!cards.includes(card)||(!draft.private.facts&&card!=='ARRIVAL'))fail('Choose an available evidence card.');
   if(!next.askedCards.some(item=>item.tokenId===witness.tokenId&&item.card===card)){
    const free=!next.sideUsed&&((next.partner.side==='BUYER'&&['BUYER_ROOMMATE','SUBJECT'].includes(witness.role))||(next.partner.side==='SELLER'&&witness.role==='SELLER_ROOMMATE'));
    if(free)next.sideUsed=true;else spend(1);
    next.askedCards.push({tokenId:witness.tokenId,card});
    if(!next.asked.includes(witness.tokenId))next.asked.push(witness.tokenId);
   }break;
  }
  case 'open':{
   const fact=pub.ledger.find(item=>item.id===action.factId);if(!fact)fail('Choose a record in this case.');
   if(!next.opened.includes(fact.id)){
    if(fact.sealed&&!next.unsealed.includes(fact.id)){spend(2);next.unsealed.push(fact.id);}
    next.opened.push(fact.id);
   }break;
  }
  case 'power':{
   if(next.powerUses<=0)fail('Your partner has already used their power.');
   if(next.partner.power==='TAKES_ONE')next.identified=draft.private.key.lie.witness;
   else if(next.partner.power==='ANALYST'&&draft.private.facts){
    if(typeof action.tokenId!=='number'||!draft.private.facts[action.tokenId]?.cards.PRICE_TALK.exactDetail)fail('Choose a witness with a verified sale price.');
    if(next.exactCards.includes(action.tokenId))fail('This exact price is already available.');
    next.exactCards.push(action.tokenId);
   }else{
    const fact=pub.ledger.find(item=>item.id===(next.partner.power==='ANALYST'?'price':action.factId));
    if(!fact?.sealed||next.unsealed.includes(fact.id))fail('Choose a record that is still sealed.');
    next.unsealed.push(fact.id);next.opened.push(fact.id);
   }
   next.powerUses--;next.powerUsed=next.powerUses===0;break;
  }
  case 'accuse':{
   const accusedCard=(action.card??'ARRIVAL') as Card;
   if(typeof action.tokenId!=='number'||!next.askedCards.some(item=>item.tokenId===action.tokenId&&item.card===accusedCard))fail('Question this witness first.');
   if(next.caught)fail('The lie has already been caught.');
   const lie=draft.private.key.lie;
   // The player supplies an opened record. Merely accusing the correct witness is insufficient.
   if(typeof action.factId!=='string'||!next.opened.includes(action.factId))fail('Open a ledger record and choose it as your proof.');
   if(action.tokenId===lie.witness&&accusedCard===lie.card&&action.factId===lie.ledgerId){next.caught=true;}
   else spend(1);
   next.accused.push(action.tokenId);break;
  }
  case 'submit':{
   const answers=action.answers;
   if(!answers||typeof answers!=='object'||Array.isArray(answers))fail('Answer all three questions.');
   const values=answers as Record<string,unknown>;
   if(Object.keys(values).length!==pub.questions.length||pub.questions.some(question=>!question.options.some(option=>option.id===values[question.id])))fail('Choose one valid answer for each question.');
   next.submittedAt=new Date().toISOString();
   next.submitted=Object.fromEntries(pub.questions.map(question=>[question.id,values[question.id] as string]));break;
  }
  default:fail('Unknown case action.');
 }
 next.revision++;return next;
}
export function viewSession(draft:CaseDraft,session:Session){
 const pub=draft.public;
 const locked=!!pub.publication&&!pub.publication.closed;
 const ledger=pub.ledger.map(fact=>{
  const sealed=fact.sealed&&!session.unsealed.includes(fact.id)&&(!session.submitted||locked);
   return sealed?{id:fact.id,sealed:true,label:fact.id==='price'?'Payment record':'Witness record'}:
   {id:fact.id,sealed:false,text:fact.text,sources:fact.sources,opened:session.opened.includes(fact.id)};
 });
 let result=null;
 if(session.submitted&&!locked){
  const questions=pub.questions.map(question=>{
   const answer=question.options.find(option=>option.id===draft.private.key.answers[question.id])!;
   const fact=pub.ledger.find(item=>item.id===question.ledgerId)!;
   return {id:question.id,prompt:question.prompt,correct:session.submitted![question.id]===answer.id,selected:session.submitted![question.id],answer:answer.label,answerId:answer.id,fact:fact.text,sources:fact.sources};
  });
  const correct=questions.filter(question=>question.correct).length;
  const points={answers:correct*100,lie:session.caught?150:0,cards:session.plays*10,perfect:correct===3?50:0};
  const score=Object.values(points).reduce((sum,value)=>sum+value,0);
  const lie=draft.private.key.lie;
  result={questions,points,score,grade:score>=450?'A':score>=330?'B':score>=200?'C':'D',lie:{...lie,name:pub.cast.find(member=>member.tokenId===lie.witness)!.name,proof:pub.ledger.find(fact=>fact.id===lie.ledgerId)!},verification:{answerHash:pub.answerHash,key:!pub.publication||pub.publication.closed?draft.private.key:null,salt:!pub.publication||pub.publication.closed?draft.private.salt:null,onchain:!!pub.publication,openTx:pub.publication?.openTx??null,closeTx:pub.publication?.closeTx??null}};
 }
 return {
  playClosed:!!pub.publication&&!session.practice&&Date.now()/1000>=pub.publication.closesAt,practice:!!session.practice,locked:!!session.submitted&&locked,closesAt:pub.publication?.closesAt??null,lieCaught:session.caught,
  caseId:pub.id,revision:session.revision,partner:session.partner,plays:session.plays,initialPlays:session.initialPlays,
  caught:session.caught,powerUsed:session.powerUsed,powerUses:session.powerUses??(session.powerUsed?0:session.partner.uses??1),identified:session.identified??null,sideUsed:session.sideUsed??false,accused:session.accused,submitted:session.submitted,
  case:{id:pub.id,publication:pub.publication??null,type:pub.type,occurredAt:pub.occurredAt,subject:pub.subject,answerHash:pub.answerHash,
   cast:pub.cast.map(member=>({tokenId:member.tokenId,name:member.name,role:member.role})),
   questions:pub.questions.map(question=>({id:question.id,prompt:question.prompt,options:question.options.map(option=>({id:option.id,label:option.label}))}))},
  cards:draft.private.facts?[...cards]:['ARRIVAL'],ledger,testimony:(session.askedCards??session.asked.map(tokenId=>({tokenId,card:'ARRIVAL' as const}))).map(item=>{const line=memoryLine(draft,item.tokenId,item.card,!!session.partner.moneyTalk||!!session.exactCards?.includes(item.tokenId));return {tokenId:line.tokenId,card:line.card,line:line.line,unknown:line.unknown,exact:line.exact};}),result,
 };
}
