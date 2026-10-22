import {test,expect} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {operatingAlerts} from '../check.mts';

async function state(files:Record<string,unknown>){const root=await mkdtemp(join(tmpdir(),'chog-alerts-'));for(const [path,value] of Object.entries(files)){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),JSON.stringify(value));}return root;}
const now=Date.parse('2026-10-22T09:00:00Z');
test('a healthy morning raises nothing',async()=>{
 const root=await state({'runs/daily/status.json':{day:'2026-10-22',status:'PUBLISHED'},'runs/owners/snapshot.json':{indexedAt:now-30_000},'runs/live/feed.json':{state:'LIVE',updatedAt:new Date(now-20_000).toISOString()},'runs/daily/cases/2026-10-22.json':{fallbackPool:40},
  'runs/puzzle-publications/2026-10-21.json':{id:'case-'+'1'.repeat(24),open:{},closesAt:Date.parse('2026-10-22T00:20:00Z')/1000,status:'COMPLETE'}});
 try{expect(await operatingAlerts({root,now,signerBalanceWei:10n**18n})).toEqual([]);}finally{await rm(root,{recursive:true,force:true});}
});
test('every condition that needs a person is named',async()=>{
 const root=await state({'runs/daily/status.json':{day:'2026-10-22',status:'READY_TO_COMMIT'},'runs/owners/snapshot.json':{indexedAt:now-11*60_000},'runs/live/feed.json':{state:'RECONNECTING',updatedAt:new Date(now-5*60_000).toISOString()},'runs/daily/cases/2026-10-22.json':{fallbackPool:6},
  'runs/puzzle-publications/2026-10-21.json':{id:'case-'+'1'.repeat(24),open:{},closesAt:Date.parse('2026-10-22T00:20:00Z')/1000,status:'CAST_RECORDED'}});
 try{expect((await operatingAlerts({root,now,signerBalanceWei:4n*10n**17n})).map(row=>row.code)).toEqual(['CASE_NOT_PUBLISHED','OWNER_INDEX_LAG','LIVE_DOWN','SIGNER_LOW','SOLVES_RECORD_FAIL','FALLBACK_POOL_LOW']);}
 finally{await rm(root,{recursive:true,force:true});}
});
test('before 00:25 UTC an unpublished case is not yet late',async()=>{
 const root=await state({'runs/owners/snapshot.json':{indexedAt:Date.parse('2026-10-22T00:24:00Z')},'runs/live/feed.json':{state:'POLLING',updatedAt:'2026-10-22T00:23:59Z'}});
 try{expect(await operatingAlerts({root,now:Date.parse('2026-10-22T00:24:00Z'),signerBalanceWei:null})).toEqual([]);}finally{await rm(root,{recursive:true,force:true});}
});
