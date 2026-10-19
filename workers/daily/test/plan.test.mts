import {test,expect} from 'vitest';
import {recoverDailySource,chooseFallbacks,sourceCaseId,sourceBefore,dailySources,type SavedPlan} from '../plan.mts';
import {draft} from '../../../packages/game/test/fixture.mts';
test('a failed daily source uses saved history after 00:10 and declares degradation',async()=>{
 const result=await recoverDailySource(async()=>{throw new Error('HyperSync offline');},async()=>({coverageAt:1}),'2026-10-19',()=>Date.parse('2026-10-19T00:10:00Z'));
 expect(result.fresh).toBe(false);expect(result.degraded).toBe(true);expect(result.reason).toBe('HyperSync offline');
 const pool=Array.from({length:16},(_,index)=>{const next=structuredClone(draft);next.public.ledger.find(fact=>fact.id==='subject')!.sources[0]!.logIndex+=index;return next;});
 expect(dailySources('2026-10-19',pool,[],null).map(item=>item.source)).toEqual(['COLD_FALLBACK','COLD_FALLBACK']);
});
test('a source failure before 00:10 is retried rather than silently choosing an early fallback',async()=>{
 let saved=0;await expect(recoverDailySource(async()=>{throw new Error('offline');},async()=>{saved++;return {coverageAt:1};},'2026-10-19',()=>Date.parse('2026-10-19T00:09:59Z'))).rejects.toThrow('DAILY_SOURCE_WAIT');expect(saved).toBe(0);
});
test('stale source coverage is degraded even when the provider request succeeds',async()=>{
 expect((await recoverDailySource(async()=>({coverageAt:1}),async()=>({coverageAt:2}),'2026-10-19',()=>Date.parse('2026-10-19T00:10:00Z'))).degraded).toBe(true);
});
test('fourteen quiet days use disjoint slots without repeating any of the previous seven plans',()=>{
 const pool=Array.from({length:16},(_,index)=>{const item=structuredClone(draft);item.public.ledger.find(fact=>fact.id==='subject')!.sources[0]!.logIndex+=index;return item;});
 const plans:SavedPlan[]=[];
 for(let offset=0;offset<14;offset++){
  const day=new Date(Date.parse('2026-10-01T00:00:00Z')+offset*86400000).toISOString().slice(0,10),selected=chooseFallbacks(day,pool,plans),ids=[sourceCaseId(selected.main),sourceCaseId(selected.cold)];
  expect(ids[0]).not.toBe(ids[1]);
  expect(plans.slice(-7).flatMap(plan=>plan.cases.map(item=>item.sourceCaseId)).some(id=>ids.includes(id!))).toBe(false);
  plans.push({day,cases:ids.map((sourceCaseId,index)=>({id:day+(index?'-cold':'-main'),kind:index?'COLD':'MAIN',source:'COLD_FALLBACK',sourceCaseId}))});
 }
});
test('fourteen sources cannot promise two slots plus seven complete excluded plans',()=>{
 expect(()=>chooseFallbacks('2026-10-19',[draft],[])).toThrow('DAILY_POOL_CAPACITY');
});

test('a hung source request releases the daily builder at its deadline',async()=>{
 await expect(sourceBefore(()=>new Promise<never>(()=>{}),Date.now()+10)).rejects.toThrow('DAILY_SOURCE_TIMEOUT');
 let called=false;await expect(sourceBefore(async()=>{called=true;},0)).rejects.toThrow('DAILY_SOURCE_TIMEOUT');expect(called).toBe(false);
});
