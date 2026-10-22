import type {EnrichedEvent,Source} from '../../core/src/enrich.mts';
import {ZERO} from '../../core/src/chain.mts';
import type {Candidate} from './select.mts';
export interface Metadata {name:string;attributes:{trait_type:string;value:string}[]}
export interface CastMember {tokenId:number;name:string;role:'SUBJECT'|'SELLER_ROOMMATE'|'BUYER_ROOMMATE'|'RECENT_SALE'|'PREVIOUS_ROOMMATE';arrival:Source;arrivedAt:number}
const source=(row:EnrichedEvent):Source=>({tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex});
const order=(a:EnrichedEvent,b:EnrichedEvent)=>a.event.block-b.event.block||a.event.logIndex-b.event.logIndex;
const attribute=(metadata:Metadata,name:string)=>metadata.attributes.find(item=>item.trait_type===name)?.value??'';
const shifty=new Set(['side eye','smirk','thug','mog','clown eye','clown eye mix']);
/** Stable JSON: keys sorted at every level, so the same case always hashes the same. */
export function canonicalJSON(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(canonicalJSON).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJSON(item)}`).join(',')}}`;
 throw new Error('CASE_CANONICAL: Unsupported value');
}
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
 // An escrow deposit moves the Chog to the escrow contract; the buyer is the deal's buyer.
 const buyer=candidate.row.event.class==='ESCROW_DEPOSIT'&&candidate.row.event.escrow?candidate.row.event.escrow.buyer:candidate.row.event.to;
 for(const [wallet,role] of [[candidate.row.event.from,'SELLER_ROOMMATE'],[buyer,'BUYER_ROOMMATE']] as const)
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
