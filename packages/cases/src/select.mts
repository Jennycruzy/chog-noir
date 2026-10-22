import type {EnrichedEvent} from '../../core/src/enrich.mts';
import {CHOG_TOKEN} from '../../core/src/chain.mts';
export type CaseType='QUICK_EXIT'|'BIG_SPENDER'|'LONG_GOODBYE'|'FIRST_MOVE'|'CHOG_TRAIL'|'COLD_CASE';
export interface CaseRules {quickExitDiscountBps:number;quickExitHoldHours:number;bigSpenderPremiumBps:number;longGoodbyeHoldDays:number;priceBandUpperMon:number[];archiveQueueSize:number}
export interface Candidate {id:string;type:CaseType;at:number;row:EnrichedEvent;trigger:string}
export interface ScoreInput {rarity:number;priceGap:number;holdDrama:number;castQuality:number;freshness:number;repeatPenalty:number}
const identity=(row:EnrichedEvent)=>`${row.event.tx}:${row.event.logIndex}`;
export function validateRules(rules:CaseRules):void{
 const integers=[rules.quickExitDiscountBps,rules.quickExitHoldHours,rules.bigSpenderPremiumBps,rules.longGoodbyeHoldDays,rules.archiveQueueSize,...rules.priceBandUpperMon];
 if(integers.some(value=>!Number.isSafeInteger(value)||value<=0)||rules.quickExitDiscountBps>=10000||rules.priceBandUpperMon.length!==4||rules.priceBandUpperMon.some((value,i)=>i>0&&value<=rules.priceBandUpperMon[i-1]!))throw new Error('CASE_RULES: Invalid thresholds');
}
export function caseScore(input:ScoreInput):number{
 for(const [name,value] of Object.entries(input))if(!Number.isFinite(value)||value<0||value>(name==='castQuality'?1.2:1))throw new Error('CASE_SCORE: Invalid normalized component');
 return 30*input.rarity+25*input.priceGap+20*input.holdDrama+15*input.castQuality+10*input.freshness-40*input.repeatPenalty;
}
export function priceGap(amount:bigint,reference:bigint|null):number{
 if(amount<0n||reference!==null&&reference<=0n)throw new Error('CASE_PRICE: Invalid price');
 if(reference===null)return 0;
 const difference=amount>reference?amount-reference:reference-amount;
 return difference>=reference?1:Number(difference*1000000n/reference)/1000000;
}
export function saleCandidates(history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,rules:CaseRules):Candidate[]{
 validateRules(rules);
 const byId=new Map<string,EnrichedEvent>();
 for(const row of history){const id=identity(row);if(byId.has(id))throw new Error('CASE_DUPLICATE: Duplicate source event');byId.set(id,row);}
 const result:Candidate[]=[];
 for(const row of history){
  const event=row.event;
  if(event.class!=='SALE'||event.from===event.to||event.price?.status!=='EXACT'||!event.price.grossWei||!event.route)continue;
  const at=times.get(event.block);
  if(at===undefined||!Number.isSafeInteger(at)||at<0)throw new Error('CASE_TIME: Missing source timestamp');
  const amount=BigInt(event.price.grossWei);if(amount<=0n)continue;
  const reference=row.priorSaleMedianWei===null?null:BigInt(row.priorSaleMedianWei);
  if(reference!==null&&reference<=0n)throw new Error('CASE_REFERENCE: Invalid median');
  const arrival=row.sources.arrival?byId.get(`${row.sources.arrival.tx}:${row.sources.arrival.logIndex}`):undefined;
  const shortResale=arrival?.event.class==='SALE'&&row.holdSeconds!==null&&row.holdSeconds>=0&&row.holdSeconds<rules.quickExitHoldHours*3600;
  const discounted=reference!==null&&amount*10000n<=reference*BigInt(10000-rules.quickExitDiscountBps);
  const types:{type:CaseType;trigger:string}[]=[];
  // A Founder leaving its minter for the first time: the arrival being sold is the mint itself.
  if(arrival?.event.class==='MINT'&&arrival.event.to===event.from)types.push({type:'FIRST_MOVE',trigger:'First move since mint: the seller is the minter and the Chog never moved before.'});
  if(shortResale||discounted)types.push({type:'QUICK_EXIT',trigger:shortResale?'Resale after a verified purchase within the configured hold window.':'Gross sale price below the seven-prior-sales median by the configured discount; this is not a historical floor quote.'});
  if(event.route==='listing_bought'&&reference!==null&&amount*10000n>=reference*BigInt(10000+rules.bigSpenderPremiumBps))types.push({type:'BIG_SPENDER',trigger:'Verified listing above the seven-prior-sales median by the configured premium; this is not a historical floor quote.'});
  if(row.holdSeconds!==null&&row.holdSeconds>=rules.longGoodbyeHoldDays*86400)types.push({type:'LONG_GOODBYE',trigger:'Sale ends a source-linked hold at least as long as the configured threshold.'});
  if(types.length===0)types.push({type:'COLD_CASE',trigger:'Archived verified sale with an exact payment; no stronger case-type trigger is inferred.'});
  for(const item of types)result.push({id:`${identity(row)}:${item.type}`,...item,at,row});
 }
 return result.sort((a,b)=>a.row.event.block-b.row.event.block||a.row.event.logIndex-b.row.event.logIndex||a.type.localeCompare(b.type));
}
/** First moves always lead (+40); a cast linked to most detectives earns +15; repeats of the last seven cases are penalised. */
export function rankCandidates(candidates:readonly Candidate[],context:{day:string;previous:readonly {tokenId:number;wallets:string[]}[];castQuality:(candidate:Candidate)=>number;linkCoverage?:(candidate:Candidate)=>number}):{candidate:Candidate;score:number;components:ScoreInput}[]{
 const start=Date.parse(`${context.day}T00:00:00Z`)/1000;
 if(!Number.isFinite(start)||new Date(start*1000).toISOString().slice(0,10)!==context.day)throw new Error('CASE_DAY: Invalid UTC day');
 const prior=candidates.filter(item=>item.at>=start-14*86400&&item.at<start);
 return candidates.filter(item=>item.at>=start&&item.at<start+86400).map(candidate=>{
  const event=candidate.row.event;
  const components:ScoreInput={rarity:prior.length?1-prior.filter(item=>item.type===candidate.type).length/prior.length:1,
   priceGap:event.price?.grossWei?priceGap(BigInt(event.price.grossWei),candidate.row.priorSaleMedianWei===null?null:BigInt(candidate.row.priorSaleMedianWei)):0,
   holdDrama:Math.min((candidate.row.holdSeconds??0)/(180*86400),1),castQuality:context.castQuality(candidate),freshness:1,
   repeatPenalty:context.previous.slice(-7).some(item=>item.tokenId===event.tokenId||item.wallets.some(wallet=>wallet.toLowerCase()===event.from.toLowerCase()||wallet.toLowerCase()===event.to.toLowerCase()))?1:0};
  return {candidate,score:caseScore(components)+(candidate.type==='FIRST_MOVE'?40:0)+((context.linkCoverage?.(candidate)??0)>=0.5?15:0),components};
 }).sort((a,b)=>b.score-a.score||b.candidate.row.event.block-a.candidate.row.event.block||b.candidate.row.event.logIndex-a.candidate.row.event.logIndex||a.candidate.id.localeCompare(b.candidate.id));
}
/** $CHOG escrow deals: the seller is paid in $CHOG at deposit, proven by the token's own Transfer log. */
export function escrowCandidates(history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>):Candidate[]{
 const result:Candidate[]=[];
 for(const row of history){
  const escrow=row.event.escrow;
  if(row.event.class!=='ESCROW_DEPOSIT'||!escrow||escrow.role!=='deposit'||!escrow.paymentAtThisTransfer||escrow.paymentToken!==CHOG_TOKEN||escrow.seller!==row.event.from||!/^\d+$/.test(escrow.amountWei)||BigInt(escrow.amountWei)<=0n||escrow.paymentProof.kind!=='ERC20')continue;
  const at=times.get(row.event.block);if(at===undefined||!Number.isSafeInteger(at)||at<0)throw new Error('CASE_TIME: Missing source timestamp');
  result.push({id:`${identity(row)}:CHOG_TRAIL`,type:'CHOG_TRAIL',trigger:'Escrow deal paid in $CHOG, proven by the token transfer to the seller.',at,row});
 }
 return result.sort((a,b)=>a.row.event.block-b.row.event.block||a.row.event.logIndex-b.row.event.logIndex);
}
