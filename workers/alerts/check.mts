import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

export interface Alert {code:string;message:string}
type Read=(path:string)=>Promise<any|null>;
const json=(root:string):Read=>async path=>{try{return JSON.parse(await readFile(join(root,path),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};

/**
 * The operating conditions that need a person: a case not published by 00:25 UTC, an owner index more than ten
 * minutes behind, the live feed down for more than two minutes, a signer below 0.5 MON, holder results not recorded
 * after a close, and a cold-case reserve below seven.
 */
export async function operatingAlerts(input:{root:string;now:number;signerBalanceWei:bigint|null}):Promise<Alert[]>{
 const {root,now}=input,read=json(root),alerts:Alert[]=[],day=new Date(now).toISOString().slice(0,10),opensAt=Date.parse(day+'T00:20:00Z');
 const status=await read('runs/daily/status.json'),dailyCase=await read(`runs/daily/cases/${day}.json`);
 if(now>=opensAt+5*60_000&&!(status?.day===day&&status.status==='PUBLISHED'))alerts.push({code:'CASE_NOT_PUBLISHED',message:`Today's case is not published (daily status: ${status?.day===day?status.status:'not started'}).`});
 const owners=await read('runs/owners/snapshot.json');
 if(!owners||now-owners.indexedAt>10*60_000)alerts.push({code:'OWNER_INDEX_LAG',message:owners?`The owner index is ${Math.round((now-owners.indexedAt)/60_000)} minutes behind.`:'The owner index has no snapshot.'});
 const live=await read('runs/live/feed.json');
 if(!live||now-Date.parse(live.updatedAt)>2*60_000||!['LIVE','POLLING','CATCHING_UP'].includes(live.state))alerts.push({code:'LIVE_DOWN',message:live?`The live feed is ${live.state}, last updated ${Math.round((now-Date.parse(live.updatedAt))/60_000)} minutes ago.`:'The live feed has not started.'});
 if(input.signerBalanceWei!==null&&input.signerBalanceWei<5n*10n**17n)alerts.push({code:'SIGNER_LOW',message:'The server signer holds less than 0.5 MON for gas.'});
 const directory=join(root,'runs/puzzle-publications');
 for(const file of (await readdir(directory).catch(()=>[] as string[])).filter(name=>/^\d{4}-\d{2}-\d{2}\.json$/.test(name))){
  const record=await read('runs/puzzle-publications/'+file);
  // The daily run closes and records within minutes of 00:20; two hours later anything missing needs attention.
  if(record?.open&&record.closesAt*1000+2*3600_000<now&&record.status!=='COMPLETE')alerts.push({code:'SOLVES_RECORD_FAIL',message:`Case ${record.id} closed but its results are not recorded on chain (status ${record.status}).`});
 }
 if(dailyCase&&dailyCase.fallbackPool<7)alerts.push({code:'FALLBACK_POOL_LOW',message:`Only ${dailyCase.fallbackPool} older sales remain eligible as cold cases.`});
 return alerts;
}
