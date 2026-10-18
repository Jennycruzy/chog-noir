import type {CaseDraft, Metadata} from '../../cases/src/build.mts';

export type Power = 'XRAY' | 'ANALYST' | 'EMPATH';
export interface Partner {tokenId:number;name:string;power:Power;description:string}
export interface Session {
 v:1;caseId:string;partner:Partner;revision:number;plays:number;initialPlays:number;
 asked:number[];opened:string[];unsealed:string[];accused:number[];caught:boolean;powerUsed:boolean;
 submitted:Record<string,string>|null;createdAt:string;
}
export class GameError extends Error {
 constructor(public status:number,message:string){super(message);}
}
function fail(message:string):never{throw new GameError(400,message);}
export function starterPartners(metadata:ReadonlyMap<number,Metadata>):Partner[]{
 const groups=new Map<Power,Partner>();
 for(const [tokenId,item] of [...metadata].sort(([a],[b])=>a-b)){
  const attr=(name:string)=>item.attributes.find(row=>row.trait_type===name)?.value.toLowerCase()??'';
  const eyes=attr('Eyes');
  const power:Power=['fire laser','purple laser','green laser','cyan laser'].includes(eyes)||attr('Head')==='blue laser'?'XRAY':
   ['anime glass','retro glass','3d glass','btc glass','gradient visor','sunset visor','plasma visor','classic vr','modern vr'].includes(eyes)?'ANALYST':'EMPATH';
  // Shifty Eyes belong to a fourth group, not Empath.
  if(power==='EMPATH'&&['side eye','smirk','thug','mog','clown eye','clown eye mix'].includes(eyes))continue;
  if(!groups.has(power))groups.set(power,{tokenId,name:item.name,power,description:power==='XRAY'?'Open one sealed record for free.':power==='ANALYST'?'Reveal the exact sale price for free.':'Start with two extra card plays.'});
 }
 if(groups.size!==3)throw new Error('GAME_PARTNERS: Missing source-backed starter group');
 return ['XRAY','ANALYST','EMPATH'].map(power=>groups.get(power as Power)!);
}
export function createSession(draft:CaseDraft,partner:Partner):Session{
 const initialPlays=partner.power==='EMPATH'?10:8;
 return {v:1,caseId:draft.public.id,partner:structuredClone(partner),revision:0,plays:initialPlays,initialPlays,asked:[],opened:[],unsealed:[],accused:[],caught:false,powerUsed:partner.power==='EMPATH',submitted:null,createdAt:new Date().toISOString()};
}
export function play(draft:CaseDraft,session:Session,action:Record<string,unknown>):Session{
 if(session.caseId!==draft.public.id)throw new Error('GAME_CASE: Session does not match archive');
 if(action.revision!==session.revision)throw new GameError(409,'The case changed. Your latest progress has been restored; try again.');
 if(session.submitted)fail('This case is already closed.');
 const next=structuredClone(session),pub=draft.public;
 const spend=(cost:number)=>{if(next.plays<cost)fail('You do not have enough card plays. You can still answer the case.');next.plays-=cost;};
 switch(action.type){
  case 'ask':{
   const witness=pub.cast.find(member=>member.tokenId===action.tokenId);
   if(!witness)fail('Choose a witness in this case.');
   if(!next.asked.includes(witness.tokenId)){spend(1);next.asked.push(witness.tokenId);}break;
  }
  case 'open':{
   const fact=pub.ledger.find(item=>item.id===action.factId);if(!fact)fail('Choose a record in this case.');
   if(!next.opened.includes(fact.id)){
    if(fact.sealed&&!next.unsealed.includes(fact.id)){spend(2);next.unsealed.push(fact.id);}
    next.opened.push(fact.id);
   }break;
  }
  case 'power':{
   if(next.powerUsed)fail('Your partner has already used their power.');
   const fact=pub.ledger.find(item=>item.id===(next.partner.power==='ANALYST'?'price':action.factId));
   if(!fact?.sealed||next.unsealed.includes(fact.id))fail('Choose a record that is still sealed.');
   next.unsealed.push(fact.id);next.opened.push(fact.id);next.powerUsed=true;break;
  }
  case 'accuse':{
   if(typeof action.tokenId!=='number'||!next.asked.includes(action.tokenId))fail('Question this witness first.');
   if(next.caught)fail('The lie has already been caught.');
   const lie=draft.private.key.lie;
   // The player supplies an opened record. Merely accusing the correct witness is insufficient.
   if(typeof action.factId!=='string'||!next.opened.includes(action.factId))fail('Open a ledger record and choose it as your proof.');
   if(action.tokenId===lie.witness&&action.factId===lie.ledgerId){next.caught=true;}
   else spend(1);
   next.accused.push(action.tokenId);break;
  }
  case 'submit':{
   const answers=action.answers;
   if(!answers||typeof answers!=='object'||Array.isArray(answers))fail('Answer all three questions.');
   const values=answers as Record<string,unknown>;
   if(Object.keys(values).length!==pub.questions.length||pub.questions.some(question=>!question.options.some(option=>option.id===values[question.id])))fail('Choose one valid answer for each question.');
   next.submitted=Object.fromEntries(pub.questions.map(question=>[question.id,values[question.id] as string]));break;
  }
  default:fail('Unknown case action.');
 }
 next.revision++;return next;
}
export function viewSession(draft:CaseDraft,session:Session){
 const pub=draft.public;
 const ledger=pub.ledger.map(fact=>{
  const sealed=fact.sealed&&!session.unsealed.includes(fact.id)&&!session.submitted;
  return sealed?{id:fact.id,sealed:true,label:fact.id==='price'?'Payment record':'Arrival record'}:
   {id:fact.id,sealed:false,text:fact.text,sources:fact.sources,opened:session.opened.includes(fact.id)};
 });
 let result=null;
 if(session.submitted){
  const questions=pub.questions.map(question=>{
   const answer=question.options.find(option=>option.id===draft.private.key.answers[question.id])!;
   const fact=pub.ledger.find(item=>item.id===question.ledgerId)!;
   return {id:question.id,prompt:question.prompt,correct:session.submitted![question.id]===answer.id,selected:session.submitted![question.id],answer:answer.label,answerId:answer.id,fact:fact.text,sources:fact.sources};
  });
  const correct=questions.filter(question=>question.correct).length;
  const points={answers:correct*100,lie:session.caught?150:0,cards:session.plays*10,perfect:correct===3?50:0};
  const score=Object.values(points).reduce((sum,value)=>sum+value,0);
  const lie=draft.private.key.lie;
  result={questions,points,score,grade:score>=450?'A':score>=330?'B':score>=200?'C':'D',lie:{...lie,name:pub.cast.find(member=>member.tokenId===lie.witness)!.name,proof:pub.ledger.find(fact=>fact.id===lie.ledgerId)!},verification:{answerHash:pub.answerHash,key:draft.private.key,salt:draft.private.salt,onchain:false}};
 }
 return {
  caseId:pub.id,revision:session.revision,partner:session.partner,plays:session.plays,initialPlays:session.initialPlays,
  caught:session.caught,powerUsed:session.powerUsed,accused:session.accused,submitted:session.submitted,
  case:{id:pub.id,type:pub.type,occurredAt:pub.occurredAt,subject:pub.subject,answerHash:pub.answerHash,
   cast:pub.cast.map(member=>({tokenId:member.tokenId,name:member.name,role:member.role})),
   questions:pub.questions.map(question=>({id:question.id,prompt:question.prompt,options:question.options.map(option=>({id:option.id,label:option.label}))}))},
  ledger,testimony:pub.testimony.filter(line=>session.asked.includes(line.tokenId)),result,
 };
}
