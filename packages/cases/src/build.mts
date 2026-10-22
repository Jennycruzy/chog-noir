import {keccak256,toBytes,formatEther} from 'viem';
import type {EnrichedEvent,Source} from '../../core/src/enrich.mts';
import {ZERO} from '../../core/src/chain.mts';
import {templateLine,type WitnessInput} from '../../witness/src/lines.mts';
import type {Candidate,CaseRules} from './select.mts';
import type {WitnessMemory} from '../../witness/src/facts.mts';
import type {Card} from '../../witness/src/facts.mts';
export interface Metadata {name:string;attributes:{trait_type:string;value:string}[]}
export interface LedgerFact {id:string;text:string;sources:Source[];sealed:boolean;answerValue?:string}
export interface Option {id:string;value:string;label:string;sources:Source[]}
export interface Question {id:string;prompt:string;options:Option[];ledgerId:string}
export interface CastMember {tokenId:number;name:string;role:'SUBJECT'|'SELLER_ROOMMATE'|'BUYER_ROOMMATE'|'RECENT_SALE'|'NEIGHBOUR'|'PREVIOUS_ROOMMATE';arrival:Source;arrivedAt:number}
export interface AnswerKey {answers:Record<string,string>;lie:{witness:number;card:Card;ledgerId:string;truth:string;claim:string};contentHash?:string}
export interface CaseDraft {
 public:{v:1;id:string;status:'DRAFT';type:Candidate['type'];occurredAt:string;subject:{tokenId:number;name:string};trigger:string;priceBasis:'GROSS_PAYMENT';cast:CastMember[];ledger:LedgerFact[];questions:Question[];testimony:{tokenId:number;card:'ARRIVAL';line:string}[];answerHash:string;publication?:{kind:'MAIN'|'COLD';day:string;opensAt:number;closesAt:number;openTx:string;closeTx:string|null;contract:string;closed:boolean}};
 private:{key:AnswerKey;salt:string;facts?:Record<string,WitnessMemory>};
}
const source=(row:EnrichedEvent):Source=>({tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex});
const order=(a:EnrichedEvent,b:EnrichedEvent)=>a.event.block-b.event.block||a.event.logIndex-b.event.logIndex;
const short=(value:string)=>`${value.slice(0,8)}…${value.slice(-6)}`;
const attribute=(metadata:Metadata,name:string)=>metadata.attributes.find(item=>item.trait_type===name)?.value??'';
const shifty=new Set(['side eye','smirk','thug','mog','clown eye','clown eye mix']);
export function canonicalJSON(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(canonicalJSON).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJSON(item)}`).join(',')}}`;
 throw new Error('CASE_CANONICAL: Unsupported value');
}
export function answerHash(caseId:string,key:AnswerKey,salt:string):string{
 if(!/^0x[0-9a-f]{64}$/i.test(salt))throw new Error('CASE_SALT: Expected 32 random bytes');
 return keccak256(toBytes(canonicalJSON({v:1,caseId,key,salt})));
}
export function caseContentHash(draft:CaseDraft):string{
 const {answerHash:_hash,publication:_publication,status:_status,...content}=draft.public;
 return keccak256(toBytes(canonicalJSON({content,facts:draft.private.facts??null})));
}
export function bindCaseContent(draft:CaseDraft):CaseDraft{
 const next=structuredClone(draft);next.private.key.contentHash=caseContentHash(next);
 next.public.answerHash=answerHash(next.public.id,next.private.key,next.private.salt);return next;
}
function pastRows(candidate:Candidate,history:readonly EnrichedEvent[]):EnrichedEvent[]{return history.filter(row=>order(row,candidate.row)<=0).sort(order);}
export function buildCast(candidate:Candidate,history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,metadata:ReadonlyMap<number,Metadata>):CastMember[]{
 const rows=pastRows(candidate,history),held=new Map<number,EnrichedEvent>();
 for(const row of rows){if(row.event.from===row.event.to)continue;if(row.event.to===ZERO)held.delete(row.event.tokenId);else held.set(row.event.tokenId,row);}
 const result:CastMember[]=[],ids=new Set<number>();
 const add=(row:EnrichedEvent,role:CastMember['role'])=>{
  const id=row.event.tokenId;if(ids.has(id)||result.length>=6)return;
  const arrival=held.get(id);if(!arrival)return;
  const name=metadata.get(id)?.name,at=times.get(arrival.event.block);
  if(!name||at===undefined)throw new Error('CASE_CAST_SOURCE: Missing name or arrival time');
  result.push({tokenId:id,name,role,arrival:source(arrival),arrivedAt:at});ids.add(id);
 };
 add(candidate.row,'SUBJECT');
 for(const [owner,role] of [[candidate.row.event.from,'SELLER_ROOMMATE'],[candidate.row.event.to,'BUYER_ROOMMATE']] as const){
  for(const row of [...held.values()].filter(row=>row.event.to===owner&&row.event.tokenId!==candidate.row.event.tokenId).sort((a,b)=>a.event.tokenId-b.event.tokenId).slice(0,2))add(row,role);
 }
 for(const row of [...rows].reverse().filter(row=>row.event.class==='SALE'&&times.get(row.event.block)!>=candidate.at-6*3600).slice(0,2))add(row,'RECENT_SALE');
 if(result.length<2)for(const row of [...held.values()].sort((a,b)=>Math.abs(a.event.tokenId-candidate.row.event.tokenId)-Math.abs(b.event.tokenId-candidate.row.event.tokenId)||a.event.tokenId-b.event.tokenId)){add(row,'NEIGHBOUR');if(result.length>=2)break;}
 if(result.length<2)throw new Error('CASE_CAST: Fewer than two source-backed witnesses');
 return result;
}
/** Witnesses must have a recorded connection to the event, never a nearby token number. */
export function buildLinkedCast(candidate:Candidate,history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,metadata:ReadonlyMap<number,Metadata>,cutoff:Source=source(candidate.row)):CastMember[]{
 const rows=history.filter(row=>row.event.block<cutoff.block||row.event.block===cutoff.block&&row.event.logIndex<=cutoff.logIndex).sort(order),held=new Map<number,EnrichedEvent>();
 for(const row of rows)if(row.event.from!==row.event.to){if(row.event.to===ZERO)held.delete(row.event.tokenId);else held.set(row.event.tokenId,row);}
 const result:CastMember[]=[],ids=new Set<number>();
 const add=(id:number,role:CastMember['role'])=>{
  if(ids.has(id))return;
  const arrival=id===candidate.row.event.tokenId?candidate.row:held.get(id);if(!arrival||arrival.event.class==='UNCLASSIFIED')return;
  const name=metadata.get(id)?.name,at=times.get(arrival.event.block);
  if(!name||at===undefined)throw new Error('CASE_CAST_SOURCE: Missing name or arrival time');
  result.push({tokenId:id,name,role,arrival:source(arrival),arrivedAt:at});ids.add(id);
 };
 add(candidate.row.event.tokenId,'SUBJECT');
 for(const [wallet,role] of [[candidate.row.event.from,'SELLER_ROOMMATE'],[candidate.row.event.to,'BUYER_ROOMMATE']] as const)
  for(const row of [...held.values()].filter(row=>row.event.to===wallet).sort((a,b)=>a.event.tokenId-b.event.tokenId))add(row.event.tokenId,role);
 for(const row of [...rows].reverse())if(row.event.class==='SALE'&&Math.abs(times.get(row.event.block)!-candidate.at)<=6*3600)add(row.event.tokenId,'RECENT_SALE');
 const earlier=new Set(rows.filter(row=>row.event.to===candidate.row.event.from).map(row=>row.event.tokenId));
 for(const id of [...earlier].sort((a,b)=>a-b))add(id,'PREVIOUS_ROOMMATE');
 const previousOwners=new Set(rows.filter(row=>row.event.tokenId===candidate.row.event.tokenId&&row.event.from!==ZERO).map(row=>row.event.from));
 for(const row of [...held.values()].sort((a,b)=>a.event.tokenId-b.event.tokenId))
  if(previousOwners.has(row.event.to))add(row.event.tokenId,'PREVIOUS_ROOMMATE');
 return result;
}
export function castQuality(cast:readonly CastMember[],metadata:ReadonlyMap<number,Metadata>):number{
 const groups=cast.map(member=>{
  const data=metadata.get(member.tokenId)!;const eyes=attribute(data,'Eyes').toLowerCase();
  if(['fire laser','purple laser','green laser','cyan laser'].includes(eyes)||attribute(data,'Head').toLowerCase()==='blue laser')return 'XRAY';
  if(['anime glass','retro glass','3d glass','btc glass','gradient visor','sunset visor','plasma visor','classic vr','modern vr'].includes(eyes))return 'ANALYST';
  return shifty.has(eyes)?'TAKES_ONE':'EMPATH';
 });
 const special=cast.some(member=>{const data=metadata.get(member.tokenId)!;return attribute(data,'Form')==='Skull'||['Radioactive','1:1'].includes(attribute(data,'Base'));});
 return new Set(groups).size/cast.length+(special?0.2:0);
}
function makeQuestion(caseId:string,id:string,prompt:string,correct:{value:string;label:string;sources:Source[]},alternatives:readonly {value:string;label:string;sources:Source[]}[],ledgerId:string):{question:Question;answer:string}{
 const values=new Map<string,typeof correct>();
 for(const item of alternatives)if(item.value!==correct.value&&!values.has(item.value))values.set(item.value,item);
 const sorted=[...values.values()].map(item=>({item,rank:keccak256(toBytes(`${caseId}:${id}:${item.value}`))})).sort((a,b)=>a.rank.localeCompare(b.rank)).map(row=>row.item);
 if(sorted.length<3)throw new Error('CASE_OPTIONS: Fewer than three real alternatives');
 const options=[correct,...sorted.slice(0,3)].sort((a,b)=>keccak256(toBytes(`${id}:${caseId}:${a.value}`)).localeCompare(keccak256(toBytes(`${id}:${caseId}:${b.value}`)))).map(item=>({id:keccak256(toBytes(`${caseId}:${id}:${item.value}`)).slice(0,18),...item}));
 return {question:{id,prompt,options,ledgerId},answer:options.find(item=>item.value===correct.value)!.id};
}
function priceBand(amount:bigint,rules:CaseRules):{value:string;label:string}{
 const index=rules.priceBandUpperMon.findIndex(bound=>amount<BigInt(bound)*10n**18n),band=index<0?rules.priceBandUpperMon.length:index;
 const lower=band===0?0:rules.priceBandUpperMon[band-1]!;const upper=rules.priceBandUpperMon[band];
 return {value:String(band),label:upper===undefined?`${lower.toLocaleString('en-US')} MON or more`:lower===0?`Below ${upper.toLocaleString('en-US')} MON`:`${lower.toLocaleString('en-US')} to below ${upper.toLocaleString('en-US')} MON`};
}
export function buildCase(candidate:Candidate,history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,metadata:ReadonlyMap<number,Metadata>,rules:CaseRules,salt:string):CaseDraft{
 const rows=pastRows(candidate,history),event=candidate.row.event,meta=metadata.get(event.tokenId);
 const original=rows.find(row=>row.event.tx===event.tx&&row.event.logIndex===event.logIndex);
 if(!original||canonicalJSON(original)!==canonicalJSON(candidate.row)||candidate.at!==times.get(event.block)||event.class!=='SALE'||event.price?.status!=='EXACT'||!event.price.grossWei||!event.route||!meta)throw new Error('CASE_SOURCE: Missing exact sale or metadata');
 const id=`sale-${event.block}-${event.logIndex}-${candidate.type.toLowerCase()}`,cast=buildCast(candidate,history,times,metadata),at=new Date(candidate.at*1000).toISOString(),src=[source(candidate.row)],amount=BigInt(event.price.grossWei);
 const paymentSources=[...src,...event.evidence.orderLogIndices.map(logIndex=>({tx:event.tx,block:event.block,logIndex}))];
 const ledger:LedgerFact[]=[{id:'subject',text:`${meta.name} changed hands on ${at}.`,sources:src,sealed:false,answerValue:String(event.tokenId)},
  {id:'seller',text:`Seller wallet: ${event.from}.`,sources:src,sealed:false,answerValue:event.from},
  {id:'buyer',text:`Buyer wallet: ${event.to}.`,sources:src,sealed:false},
  {id:'price',text:`Gross payment: ${formatEther(amount)} ${event.price.asset}. Fees are included in this amount.`,sources:paymentSources,sealed:true,answerValue:priceBand(amount,rules).value},
  {id:'route',text:event.route==='offer_accepted'?'The seller accepted an offer.':'The buyer purchased a listing.',sources:paymentSources,sealed:false}];
 if(candidate.row.priorSaleMedianWei!==null)ledger.push({id:'reference',text:`Around ${formatEther(BigInt(candidate.row.priorSaleMedianWei))} MON/WMON: median gross payment of the seven preceding supported sales. This is a reference, not a recorded floor quote.`,sources:candidate.row.sources.priorSales,sealed:false});
 const questions:Question[]=[],answers:Record<string,string>={};
 const add=(question:ReturnType<typeof makeQuestion>)=>{questions.push(question.question);answers[question.question.id]=question.answer;};
 add(makeQuestion(id,'chog','Which Chog changed hands?',{value:String(event.tokenId),label:meta.name,sources:src},rows.map(row=>({value:String(row.event.tokenId),label:metadata.get(row.event.tokenId)?.name??'',sources:[source(row)]})).filter(item=>item.label!==''),'subject'));
 const band=priceBand(amount,rules);
 add(makeQuestion(id,'price','Which band contains the gross payment? MON and WMON use the same native-unit bands.',{...band,sources:src},Array.from({length:5},(_,index)=>({...priceBand(index===0?0n:BigInt(rules.priceBandUpperMon[index-1]!)*10n**18n,rules),sources:[]})),'price'));
 const hold=candidate.row.holdSeconds;
 const holdOptions=rows.filter(row=>row.holdSeconds!==null&&row.event.from!==row.event.to).map(row=>({value:String(Math.floor(row.holdSeconds!/86400)),label:`${Math.floor(row.holdSeconds!/86400)} completed days`,sources:[source(row),...(row.sources.arrival?[row.sources.arrival]:[])]}));
 if(hold!==null&&new Set(holdOptions.map(item=>item.value)).size>=4&&candidate.row.sources.arrival){
  const days=Math.floor(hold/86400);ledger.push({id:'hold',text:`The seller held ${meta.name} for ${days} completed days before the sale.`,sources:[...src,candidate.row.sources.arrival],sealed:false,answerValue:String(days)});
  add(makeQuestion(id,'hold','How long did the seller hold this Chog?',{value:String(days),label:`${days} completed days`,sources:[...src,candidate.row.sources.arrival]},holdOptions,'hold'));
 }else add(makeQuestion(id,'seller','Which wallet sold this Chog?',{value:event.from,label:event.from,sources:src},rows.flatMap(row=>[row.event.from,row.event.to].filter(wallet=>wallet!==ZERO).map(wallet=>({value:wallet,label:wallet,sources:[source(row)]}))),'seller'));
 const scored=cast.map(member=>{const data=metadata.get(member.tokenId)!;return {member,score:(shifty.has(attribute(data,'Eyes').toLowerCase())?3:0)+(attribute(data,'Mouth').toLowerCase()==='clown'?1:0)+(attribute(data,'Form')==='Skull'?1:0)};}).sort((a,b)=>b.score-a.score||b.member.tokenId-a.member.tokenId);
 const liar=scored[0]!.score>0?scored[0]!.member:cast[0]!;
 const truth=new Date(liar.arrivedAt*1000).toISOString().slice(0,10),usedDates=new Set([at.slice(0,10),...cast.map(member=>new Date(member.arrivedAt*1000).toISOString().slice(0,10))]);
 const claim=Array.from({length:5},(_,index)=>new Date((liar.arrivedAt-(index+1)*86400)*1000).toISOString().slice(0,10)).find(date=>!usedDates.has(date));
 if(!claim)throw new Error('CASE_LIE: No distinct plausible date available');
 const lieLedger=`arrival-${liar.tokenId}`;
 const testimony=cast.map((member,index)=>{
  const date=new Date(member.arrivedAt*1000).toISOString().slice(0,10),isLie=member.tokenId===liar.tokenId;
  ledger.push({id:`arrival-${member.tokenId}`,text:`${member.name} arrived in wallet ${short(rows.find(row=>row.event.tx===member.arrival.tx&&row.event.logIndex===member.arrival.logIndex)!.event.to)} on ${date}.`,sources:[member.arrival],sealed:isLie});
  const input:WitnessInput={id:`${id}:${member.tokenId}`,card:'ARRIVAL',voice:(['nervous','sharp','dreamy','cool'] as const)[index%4]!,isLie,cleanPersona:'Template voice using source-linked arrival facts.',displayFacts:[member.name,`arrived on ${isLie?claim:date}`],trueFacts:[member.name,`arrived on ${date}`],sources:[member.arrival]};
  return {tokenId:member.tokenId,card:'ARRIVAL' as const,line:templateLine(input,index%3).line};
 });
 const key:AnswerKey={answers,lie:{witness:liar.tokenId,card:'ARRIVAL',ledgerId:lieLedger,truth,claim}};
 return {public:{v:1,id,status:'DRAFT',type:candidate.type,occurredAt:at,subject:{tokenId:event.tokenId,name:meta.name},trigger:candidate.trigger,priceBasis:'GROSS_PAYMENT',cast,ledger,questions,testimony,answerHash:answerHash(id,key,salt)},private:{key,salt}};
}
export function validateCase(draft:CaseDraft):string[]{
 const errors:string[]=[],pub=draft.public,key=draft.private.key;
 if(pub.questions.length!==3||new Set(pub.questions.map(question=>question.id)).size!==3)errors.push('QUESTIONS');
 const facts=new Map(pub.ledger.map(fact=>[fact.id,fact]));
 for(const question of pub.questions){const correct=question.options.filter(option=>option.id===key.answers[question.id]);if(question.options.length!==4||new Set(question.options.map(option=>option.value)).size!==4||correct.length!==1||correct[0]?.value!==facts.get(question.ledgerId)?.answerValue)errors.push('ANSWER');}
 if(!facts.get(key.lie.ledgerId)?.text.includes(key.lie.truth)||key.lie.truth===key.lie.claim)errors.push('LIE_PROOF');
 if(pub.cast.length<2||pub.cast.length>6||new Set(pub.cast.map(member=>member.tokenId)).size!==pub.cast.length)errors.push('CAST');
 if(pub.ledger.filter(fact=>fact.sealed).length!==2||pub.ledger.some(fact=>fact.sources.length===0))errors.push('LEDGER');
 if(answerHash(pub.id,key,draft.private.salt)!==pub.answerHash)errors.push('HASH');
 if(key.contentHash&&caseContentHash(draft)!==key.contentHash)errors.push('CONTENT_HASH');
 return [...new Set(errors)];
}
export function verifyCaseSources(draft:CaseDraft,candidates:readonly Candidate[],history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,metadata:ReadonlyMap<number,Metadata>,rules:CaseRules):string[]{
 const candidate=candidates.find(item=>`sale-${item.row.event.block}-${item.row.event.logIndex}-${item.type.toLowerCase()}`===draft.public.id);
 if(!candidate)return ['SOURCE_EVENT'];
 try{return canonicalJSON(buildCase(candidate,history,times,metadata,rules,draft.private.salt))===canonicalJSON(draft)?[]:['SOURCE_MISMATCH'];}
 catch{return ['SOURCE_MISMATCH'];}
}
