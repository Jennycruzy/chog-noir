import {createHash} from 'node:crypto';
import {mkdir,open,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import {ZERO} from '../../core/src/chain.mts';
import {withPlayerLock} from './player-lock.mts';

export class ArcError extends Error {constructor(public readonly code:string,message:string,public readonly status=400){super(message);}}
export interface ArcMove {at:number;kind:string;tx:string;block:number;logIndex:number}
export interface Arc {tokenId:number;since:number;moves:ArcMove[]}
const WEEK=7*86400;
const kinds:Record<string,string>={SALE:'sold',PLAIN_TRANSFER:'moved',SMART_WALLET_ACTION:'moved',BULK_MOVE:'moved in a bulk move',ESCROW_DEPOSIT:'went into escrow',ESCROW_COLLECTION:'left escrow'};

/** Real moves of one Chog, oldest first. Mints and same-wallet transfers are not moves. */
export function movesOf(history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,tokenId:number):ArcMove[]{
 return history.filter(row=>row.event.tokenId===tokenId&&row.event.from!==ZERO&&row.event.from!==row.event.to&&row.event.class!=='UNCLASSIFIED')
  .map(row=>({at:times.get(row.event.block)!,kind:kinds[row.event.class]??'moved',tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex}))
  .filter(row=>Number.isSafeInteger(row.at)).sort((a,b)=>a.block-b.block||a.logIndex-b.logIndex);
}
/**
 * The ongoing story: the Chog with the most real moves in the past week, at least three. The latest case's subject is
 * preferred when it qualifies, so a case can end on a hook that the next days continue.
 */
export function currentArc(history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,now:number,preferred:number|null=null):Arc|null{
 const counts=new Map<number,number>();
 for(const row of history){const at=times.get(row.event.block);if(at===undefined||at<now-WEEK||at>now||row.event.from===ZERO||row.event.from===row.event.to||row.event.class==='UNCLASSIFIED')continue;counts.set(row.event.tokenId,(counts.get(row.event.tokenId)??0)+1);}
 const ranked=[...counts].filter(([,count])=>count>=3).sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
 const tokenId=preferred!==null&&ranked.some(([id])=>id===preferred)?preferred:ranked[0]?.[0];
 if(tokenId===undefined)return null;
 return {tokenId,since:now-WEEK,moves:movesOf(history,times,tokenId).filter(row=>row.at>=now-WEEK&&row.at<=now)};
}
/** The hook a closed case ends on: the subject's first real move after the case's evidence cutoff, if any. */
export function caseHook(history:readonly EnrichedEvent[],times:ReadonlyMap<number,number>,tokenId:number,cutoffBlock:number,until:number){
 const next=movesOf(history,times,tokenId).find(row=>row.block>cutoffBlock&&row.at<=until);
 return next?{text:`It ${next.kind} again at ${new Date(next.at*1000).toISOString().slice(11,16)} UTC…`,source:{tx:next.tx,block:next.block,logIndex:next.logIndex}}:null;
}

/** Free hunches with no stake: one per browser per UTC day, kept as anonymous counts and resolved by the chain. */
export class HunchDesk {
 constructor(private readonly root:string){}
 private directory(tokenId:number,day:string){if(!Number.isSafeInteger(tokenId)||tokenId<1||tokenId>1969||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new ArcError('HUNCH_INPUT_INVALID','Choose today’s hunch.');return join(this.root,'runs/arc',String(tokenId),day);}
 async cast(tokenId:number,day:string,voter:string,answer:'yes'|'no'){
  if(!/^[a-f0-9]{64}$/.test(voter)||!['yes','no'].includes(answer))throw new ArcError('HUNCH_INPUT_INVALID','Choose yes or no.');
  const directory=this.directory(tokenId,day);await mkdir(directory,{recursive:true,mode:0o700});
  const id=createHash('sha256').update(voter).digest('hex');
  return withPlayerLock(this.root,createHash('sha256').update('hunch:'+tokenId+':'+day).digest('hex'),async()=>{
   // The first answer stands: a browser that already voted today, either way, is not counted again.
   if(!(await readdir(directory)).some(name=>name.startsWith(id+'.'))){const file=await open(join(directory,id+'.'+answer),'wx',0o600);await file.close();}
   return this.tally(tokenId,day,voter);
  });
 }
 async tally(tokenId:number,day:string,voter?:string){
  const files=await readdir(this.directory(tokenId,day)).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return [] as string[];throw error;});
  const id=voter?createHash('sha256').update(voter).digest('hex'):null,mine=id?files.find(name=>name.startsWith(id+'.'))?.split('.')[1]??null:null;
  return {yes:files.filter(name=>name.endsWith('.yes')).length,no:files.filter(name=>name.endsWith('.no')).length,mine:mine as 'yes'|'no'|null};
 }
}
export function hunchResult(moves:readonly ArcMove[],day:string){
 const start=Date.parse(day+'T00:00:00Z')/1000;return moves.some(row=>row.at>=start&&row.at<start+86400)?'yes' as const:'no' as const;
}
