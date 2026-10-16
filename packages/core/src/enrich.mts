import { ZERO, type Classification } from './chain.mts';
export interface Source { tx:string;block:number;logIndex:number }
export interface EnrichedEvent {
  event:Classification;
  holdSeconds:number|null;
  ownersBefore:number;
  receiverNewToChogs:boolean|null;
  priorSaleMedianWei:string|null;
  priceReferenceReason:'SEVEN_PRIOR_SALES'|'INSUFFICIENT_PRIOR_SALES';
  buyerSalesInUtcDay:number;
  sellerSalesInUtcDay:number;
  sources:{transfer:Source;arrival:Source|null;priorSales:Source[];owners:Source[]};
}
export function enrichHistory(events:readonly Classification[], times:ReadonlyMap<number,number>):EnrichedEvent[] {
  const held=new Map<number,{owner:string;time:number;source:Source}>();
  const owners=new Map<number,Map<string,Source>>();
  const everHeld=new Set<string>();
  const priorSales:{amount:bigint;source:Source}[]=[];
  const dayBuys=new Map<string,number>();
  const daySells=new Map<string,number>();
  const rows:{day:string;value:EnrichedEvent}[]=[];
  const seen=new Set<string>();
  for(const event of [...events].sort((a,b)=>a.block-b.block||a.logIndex-b.logIndex)) {
    const id=`${event.tx}:${event.logIndex}`;
    if(seen.has(id)) throw new Error('DATA_ENRICH_DUPLICATE: Repeated transfer');
    seen.add(id);
    const timestamp=times.get(event.block);
    if(timestamp===undefined||!Number.isSafeInteger(timestamp)||timestamp<0) throw new Error('DATA_ENRICH_TIME: Source time missing or invalid');
    const day=new Date(timestamp*1000).toISOString().slice(0,10);
    const source={tx:event.tx,block:event.block,logIndex:event.logIndex};
    const previous=held.get(event.tokenId);
    if(event.from!==ZERO&&(!previous||previous.owner!==event.from||previous.time>timestamp)) throw new Error('DATA_ENRICH_GAP: Incomplete ownership history');
    if(event.from===ZERO&&owners.has(event.tokenId)) throw new Error('DATA_ENRICH_MINT: Duplicate mint');
    const tokenOwners=owners.get(event.tokenId)??new Map<string,Source>();
    const recent=priorSales.slice(-7);
    const median=recent.length===7?[...recent].sort((a,b)=>a.amount<b.amount?-1:a.amount>b.amount?1:0)[3]!.amount.toString():null;
    const value:EnrichedEvent={event,holdSeconds:previous?timestamp-previous.time:null,ownersBefore:tokenOwners.size,receiverNewToChogs:event.to===ZERO?null:!everHeld.has(event.to),priorSaleMedianWei:median,priceReferenceReason:median===null?'INSUFFICIENT_PRIOR_SALES':'SEVEN_PRIOR_SALES',buyerSalesInUtcDay:0,sellerSalesInUtcDay:0,sources:{transfer:source,arrival:previous?.source??null,priorSales:recent.map(sale=>sale.source),owners:[...tokenOwners.values()]}};
    rows.push({day,value});
    if(event.class==='SALE') {
      if(!event.price||!event.route) throw new Error('DATA_ENRICH_PRICE: Sale payment evidence missing');
      const buy=`${day}:${event.to}`;const sell=`${day}:${event.from}`;
      dayBuys.set(buy,(dayBuys.get(buy)??0)+1);daySells.set(sell,(daySells.get(sell)??0)+1);
      if(event.price?.status==='EXACT'&&event.price.grossWei!==null) priorSales.push({amount:BigInt(event.price.grossWei),source});
    }
    if(event.from!==event.to) {
      held.delete(event.tokenId);
      if(event.to!==ZERO) held.set(event.tokenId,{owner:event.to,time:timestamp,source});
    }
    if(event.to!==ZERO) {if(!tokenOwners.has(event.to)) tokenOwners.set(event.to,source);everHeld.add(event.to);}
    owners.set(event.tokenId,tokenOwners);
  }
  return rows.map(({day,value})=>({...value,buyerSalesInUtcDay:dayBuys.get(`${day}:${value.event.to}`)??0,sellerSalesInUtcDay:daySells.get(`${day}:${value.event.from}`)??0}));
}
