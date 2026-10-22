import type {EnrichedEvent} from '../../core/src/enrich.mts';
import {nativeBand} from '../../witness/src/facts.mts';
export interface FeedEvent {id:string;tx:string;block:number;logIndex:number;tokenId:number;time:string;priceBand:string;route:string;grossWei:string;asset:string}
export function saleFeed(rows:readonly EnrichedEvent[],times:ReadonlyMap<number,number>):FeedEvent[]{
 const result=new Map<string,FeedEvent>();
 for(const row of rows){
  const event=row.event;if(event.class!=='SALE'||event.price?.status!=='EXACT'||!event.price.grossWei||!event.route)continue;
  const at=times.get(event.block);if(at===undefined)throw new Error('FEED_TIME: Missing source block time');
  const item={id:`${event.tx}:${event.logIndex}`,tx:event.tx,block:event.block,logIndex:event.logIndex,tokenId:event.tokenId,time:new Date(at*1000).toISOString(),priceBand:nativeBand(BigInt(event.price.grossWei)),route:event.route,grossWei:event.price.grossWei,asset:event.price.asset};
  const previous=result.get(item.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(item))throw new Error('FEED_CONFLICT: Conflicting sale identity');result.set(item.id,item);
 }
 return [...result.values()].sort((a,b)=>a.block-b.block||a.logIndex-b.logIndex);
}
/** The ticker and Breaking line: name and an approximate price, nothing else. */
export function feedLine(event:Pick<FeedEvent,'grossWei'|'asset'>,name:string){
 const amount=((BigInt(event.grossWei)+25n*10n**18n)/(50n*10n**18n)*50n).toLocaleString('en-US');
 return `${name} just sold for about ${amount} ${event.asset}`;
}
