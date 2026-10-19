import {formatEther} from 'viem';
import type {CaseDraft,Metadata} from '../../cases/src/build.mts';
import type {EnrichedEvent,Source} from '../../core/src/enrich.mts';
import {ZERO} from '../../core/src/chain.mts';
import {traitsFor} from '../../traits/src/traits.mts';
import {cards,templateLine,type WitnessInput} from './lines.mts';
export type Card=typeof cards[number];
export interface CardFact {detail:string;date?:string;sources:Source[];exactDetail?:string;unknown?:boolean}
export interface WitnessMemory {
 tokenId:number;name:string;voice:WitnessInput['voice'];cutoff:Source;at:number;
 owners:{wallet:string;arrivedAt:number;departedAt:number|null;sources:Source[]}[];
 sales:{at:number;grossWei:string;asset:string;route:string;sources:Source[]}[];
 roommates:{tokenId:number;name:string;sources:Source[]}[];
 cards:Record<Card,CardFact>;
 frozen?:Partial<Record<Card,{band:string;exact:string}>>;
}
const source=(row:EnrichedEvent):Source=>({tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex});
const before=(a:Source,b:Source)=>a.block<b.block||a.block===b.block&&a.logIndex<=b.logIndex;
const short=(wallet:string)=>`${wallet.slice(0,6)}…${wallet.slice(-4)}`;
const day=(at:number)=>new Date(at*1000).toISOString().slice(0,10);
export function nativeBand(amount:bigint):string{
 return amount<4000n*10n**18n?'below 4,000 MON':amount<5000n*10n**18n?'4,000–4,999 MON':amount<6000n*10n**18n?'5,000–5,999 MON':amount<8000n*10n**18n?'6,000–7,999 MON':'at least 8,000 MON';
}
export function buildMemories(draft:CaseDraft,history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,metadata:ReadonlyMap<number,Metadata>):Record<string,WitnessMemory>{
 const cutoff=draft.public.ledger.find(fact=>fact.id==='subject')!.sources[0]!;
 const rows=history.filter(row=>before(source(row),cutoff)).sort((a,b)=>a.event.block-b.event.block||a.event.logIndex-b.event.logIndex);
 const held=new Map<number,EnrichedEvent>();
 for(const row of rows){if(row.event.from===row.event.to)continue;if(row.event.to===ZERO)held.delete(row.event.tokenId);else held.set(row.event.tokenId,row);}
 const at=times.get(cutoff.block);if(at===undefined)throw new Error('WITNESS_TIME: Missing cutoff time');
 // Payment logs can follow the NFT Transfer within the same atomic sale. Accept
 // only order-log indices already bound by that sale's classifier, not later
 // ownership events in the block or unrelated logs in its transaction.
 const paymentProofs=new Set(rows.filter(row=>row.event.tx===cutoff.tx).flatMap(row=>row.event.evidence.orderLogIndices));
 const supported=(item:Source)=>before(item,cutoff)||(item.tx===cutoff.tx&&item.block===cutoff.block&&paymentProofs.has(item.logIndex));
 const result:Record<string,WitnessMemory>={};
 for(const member of draft.public.cast){
  const moves=rows.filter(row=>row.event.tokenId===member.tokenId),arrival=held.get(member.tokenId),meta=metadata.get(member.tokenId);
  if(!arrival||!meta)throw new Error('WITNESS_SOURCE: Missing witness history or metadata');
  const time=(row:EnrichedEvent)=>{const value=times.get(row.event.block);if(value===undefined||value>at)throw new Error('WITNESS_TIME: Missing or future event time');return value;};
  const owners:WitnessMemory['owners']=[];
  for(const row of moves){
   if(row.event.from===row.event.to)continue;
   const previous=owners.at(-1);if(previous){previous.departedAt=time(row);previous.sources.push(source(row));}
   if(row.event.to!==ZERO)owners.push({wallet:row.event.to,arrivedAt:time(row),departedAt:null,sources:[source(row)]});
  }
  const sales=moves.filter(row=>row.event.class==='SALE'&&row.event.price?.status==='EXACT'&&row.event.price.grossWei&&row.event.route).map(row=>({at:time(row),grossWei:row.event.price!.grossWei!,asset:row.event.price!.asset,route:row.event.route!,sources:[source(row),...row.event.evidence.orderLogIndices.map(logIndex=>({tx:row.event.tx,block:row.event.block,logIndex}))]}));
  const lastSale=sales.at(-1),longest=owners.filter(item=>item.departedAt!==null).sort((a,b)=>(b.departedAt!-b.arrivedAt)-(a.departedAt!-a.arrivedAt))[0];
  const roommates=[...held.values()].filter(row=>row.event.to===arrival.event.to&&row.event.tokenId!==member.tokenId).sort((a,b)=>a.event.tokenId-b.event.tokenId).map(row=>({tokenId:row.event.tokenId,name:metadata.get(row.event.tokenId)!.name,sources:[source(row)]}));
  const recent=moves.filter(row=>time(row)>=at-14*86400),night=moves.filter(row=>time(row)>=Math.floor(at/86400)*86400),ownerCount=new Set(owners.map(owner=>owner.wallet)).size;
  const seller=draft.public.ledger.find(fact=>fact.id==='seller')!.answerValue!;
  const known=owners.some(owner=>owner.wallet===seller);
  const anchor=[source(arrival),cutoff];
  const cardFacts:Record<Card,CardFact>={
   LAST_SALE:lastSale?{detail:nativeBand(BigInt(lastSale.grossWei)),date:day(lastSale.at),sources:lastSale.sources,exactDetail:`${formatEther(BigInt(lastSale.grossWei))} ${lastSale.asset}`}:{detail:'no verified sale in this saved history',date:day(at),sources:anchor,unknown:true},
   LONGEST_HOLD:longest?{detail:`longest completed hold: ${Math.floor((longest.departedAt!-longest.arrivedAt)/86400)} days by ${short(longest.wallet)}`,sources:longest.sources}:{detail:'no completed hold in this saved history',sources:anchor,unknown:true},
   LAST_NIGHT:{detail:`${night.length} recorded transfers on ${day(at)} before the case cutoff`,sources:night.length?night.map(source):anchor},
   ROOMMATES:{detail:roommates.length?`shares with ${roommates.slice(0,2).map(item=>item.name).join(' and ')}${roommates.length>2?`; ${roommates.length} roommates in total`:''}`:'no other Chog in this wallet at the cutoff',sources:[...anchor,...roommates.slice(0,2).flatMap(item=>item.sources)]},
   ARRIVAL:{detail:`arrived on ${day(time(arrival))}`,sources:[source(arrival)]},
   GIFT_OR_SALE:{detail:arrival.event.class==='SALE'?'a purchase with verified payment':arrival.event.class==='MINT'?'received at mint':arrival.event.class==='ESCROW_COLLECTION'?'collected from escrow; payment belongs to its deposit':arrival.event.class==='ESCROW_DEPOSIT'?'entered escrow with verified payment':'a transfer; payment and intent are unconfirmed',sources:anchor},
   PRICE_TALK:lastSale?{detail:nativeBand(BigInt(lastSale.grossWei)),exactDetail:`${formatEther(BigInt(lastSale.grossWei))} ${lastSale.asset}`,sources:lastSale.sources}:{detail:'no verified sale price in this saved history',sources:anchor,unknown:true},
   KNOW_WALLET:{detail:`${short(seller)} ${known?'held this Chog':'has no recorded hold in this history'}`,sources:known?owners.filter(owner=>owner.wallet===seller).flatMap(owner=>owner.sources):[...anchor,...draft.public.ledger.find(fact=>fact.id==='seller')!.sources]},
   OWNER_COUNT:{detail:`${ownerCount} recorded owner wallets`,sources:owners.flatMap(owner=>owner.sources)},
   ODD_MOVES:{detail:`${recent.length} recorded transfers in the preceding fourteen days`,sources:recent.length?recent.map(source):anchor},
  };
  for(const card of cards){if(!cardFacts[card].sources.length||cardFacts[card].sources.some(item=>!supported(item)))throw new Error(`WITNESS_SOURCE: Missing or future evidence for ${draft.public.id}/${member.tokenId}/${card}`);}
  result[member.tokenId]={tokenId:member.tokenId,name:member.name,voice:traitsFor(member.tokenId,meta).voice,cutoff,at,owners,sales,roommates,cards:cardFacts};
 }
 return result;
}
export function memoryLine(draft:CaseDraft,tokenId:number,card:Card,exact=false){
 const memory=draft.private.facts?.[tokenId];
 if(!memory){const saved=draft.public.testimony.find(item=>item.tokenId===tokenId&&item.card===card);if(!saved)throw new Error('WITNESS_CARD: Memory unavailable');return {...saved,sources:draft.public.cast.find(member=>member.tokenId===tokenId)!.arrival?[draft.public.cast.find(member=>member.tokenId===tokenId)!.arrival]:[],unknown:false,exact:false};}
 const fact=memory.cards[card],isLie=draft.private.key.lie.witness===tokenId&&draft.private.key.lie.card===card;
 const frozen=memory.frozen?.[card];
 if(frozen)return {tokenId,card,line:exact&&fact.exactDetail?frozen.exact:frozen.band,sources:fact.sources,unknown:!!fact.unknown,exact:!!(exact&&fact.exactDetail)};
 if(fact.unknown)return {tokenId,card,line:`${memory.name}: I don't have that in the saved record.`,sources:fact.sources,unknown:true,exact:false};
 const detail=exact&&fact.exactDetail?fact.exactDetail:fact.detail;
 const displayFacts=[memory.name,detail,...(card==='LAST_SALE'?[fact.date!]:[])];
 const trueFacts=[...displayFacts];if(isLie)displayFacts[1]=detail.replace(draft.private.key.lie.truth,draft.private.key.lie.claim);
 const input:WitnessInput={id:`${draft.public.id}:${tokenId}:${card}`,card,voice:memory.voice,isLie,cleanPersona:`${memory.voice} witness`,displayFacts,trueFacts,sources:fact.sources};
 const output=templateLine(input);
 return {tokenId,card,line:output.line,sources:fact.sources,unknown:!!fact.unknown,exact:!!(exact&&fact.exactDetail)};
}
export function freezeMemories(draft:CaseDraft):void{
 if(!draft.private.facts)throw new Error('WITNESS_FREEZE: Missing source memories');
 for(const memory of Object.values(draft.private.facts)){
  delete memory.frozen;
  const frozen:WitnessMemory['frozen']={};
  for(const card of cards)frozen[card]={band:memoryLine(draft,memory.tokenId,card).line,exact:memoryLine(draft,memory.tokenId,card,true).line};
  memory.frozen=frozen;
 }
}
