import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {precinctReport} from '../src/report.mts';
import type {EnrichedEvent} from '../src/enrich.mts';
const fixture=JSON.parse(await readFile(new URL('../../cases/test/fixtures/sales.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
test('daily report is restricted to its UTC day and carries every counted source',()=>{
 const times=new Map(fixture.times),day=new Date(Math.max(...times.values())*1000).toISOString().slice(0,10),report=precinctReport(day,fixture.rows,times);
 expect(report.sources.length).toBe(report.transfers);expect(report.sources.every(source=>new Date(times.get(source.block)!*1000).toISOString().startsWith(day))).toBe(true);
});
test('report cannot silently normalize an impossible date',()=>{expect(()=>precinctReport('2026-02-30',[],new Map())).toThrow('Invalid day');});
test('an empty covered day has no invented price range',()=>{const report=precinctReport('2026-10-01',[],new Map());expect(report.sales).toBe(0);expect(report.highest).toBe(null);expect(report.lowest).toBe(null);});
