import {test,expect} from 'vitest';
import {recoverDailySource,sourceBefore} from '../plan.mts';
test('a failed daily source uses saved history after 00:10 and declares degradation',async()=>{
 const result=await recoverDailySource(async()=>{throw new Error('HyperSync offline');},async()=>({coverageAt:1}),'2026-10-19',()=>Date.parse('2026-10-19T00:10:00Z'));
 expect(result.fresh).toBe(false);expect(result.degraded).toBe(true);expect(result.reason).toBe('HyperSync offline');
});
test('a source failure before 00:10 is retried rather than silently choosing an early fallback',async()=>{
 let saved=0;await expect(recoverDailySource(async()=>{throw new Error('offline');},async()=>{saved++;return {coverageAt:1};},'2026-10-19',()=>Date.parse('2026-10-19T00:09:59Z'))).rejects.toThrow('DAILY_SOURCE_WAIT');expect(saved).toBe(0);
});
test('stale source coverage is degraded even when the provider request succeeds',async()=>{
 expect((await recoverDailySource(async()=>({coverageAt:1}),async()=>({coverageAt:2}),'2026-10-19',()=>Date.parse('2026-10-19T00:10:00Z'))).degraded).toBe(true);
});
test('a hung source request releases the daily builder at its deadline',async()=>{
 await expect(sourceBefore(()=>new Promise<never>(()=>{}),Date.now()+10)).rejects.toThrow('DAILY_SOURCE_TIMEOUT');
 let called=false;await expect(sourceBefore(async()=>{called=true;},0)).rejects.toThrow('DAILY_SOURCE_TIMEOUT');expect(called).toBe(false);
});
