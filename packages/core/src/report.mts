import {formatEther} from 'viem';
import type {EnrichedEvent} from './enrich.mts';
export function precinctReport(day:string,history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>){
 const start=Date.parse(day+'T00:00:00Z')/1000;
 if(!Number.isFinite(start)||new Date(start*1000).toISOString().slice(0,10)!==day)throw new Error('REPORT_DAY: Invalid day');
 const rows=history.filter(row=>{const at=times.get(row.event.block);return at!==undefined&&at>=start&&at<start+86400;});
 const sales=rows.filter(row=>row.event.class==='SALE'&&row.event.price?.status==='EXACT'&&row.event.price.grossWei!==null);
 const ordered=[...sales].sort((a,b)=>BigInt(a.event.price!.grossWei!)<BigInt(b.event.price!.grossWei!)?-1:1);
 const source=(row:EnrichedEvent)=>({tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex});
 const extreme=(row:EnrichedEvent|undefined)=>row?{tokenId:row.event.tokenId,amount:formatEther(BigInt(row.event.price!.grossWei!)),asset:row.event.price!.asset,source:source(row)}:null;
 return {day,transfers:rows.length,sales:sales.length,mints:rows.filter(row=>row.event.class==='MINT').length,
  escrowDeposits:rows.filter(row=>row.event.class==='ESCROW_DEPOSIT').length,escrowCollections:rows.filter(row=>row.event.class==='ESCROW_COLLECTION').length,
  unclassified:rows.filter(row=>row.event.class==='UNCLASSIFIED').length,distinctChogs:new Set(rows.map(row=>row.event.tokenId)).size,
  lowest:extreme(ordered[0]),highest:extreme(ordered.at(-1)),sources:rows.map(source),
  note:'Sales are supported Seaport sales with exact gross payments, including fees. MON and WMON share native units. Escrow deposits and collections are separate movements, not extra Seaport sales. Transfer intent is not inferred.'};
}
