import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import config from '../../../config/cases.json' with {type:'json'};
import type {EnrichedEvent} from '../../../packages/core/src/enrich.mts';
import type {OwnerSnapshot} from '../../../packages/auth/src/holders.mts';
import type {Metadata} from '../../../packages/cases/src/build.mts';
import {validatePuzzle,planFor} from '../../../packages/cases/src/puzzle.mts';
import {buildDailyPuzzle,type CaseEvent} from '../build.mts';
import {puzzleSources} from '../receipts.mts';

// Real records: six Chogs from 4 Sep to 4 Oct, including five sales on Sat 3 Oct.
const fixture=JSON.parse(readFileSync(new URL('../../../packages/cases/test/fixtures/witness-window.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const {snapshot:ownership}=JSON.parse(readFileSync(new URL('../../../packages/auth/test/fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot};
const {tokens}=JSON.parse(readFileSync(new URL('../../../packages/traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata}[]};
const source={history:fixture.rows,times:new Map(fixture.times),metadata:new Map(tokens.map(row=>[row.tokenId,row.metadata])),ownership,bulkSources:[],rules:config};
const salt='0x'+'5e'.repeat(32);
const build=(day:string,previous:CaseEvent[]=[])=>buildDailyPuzzle({...source,day,salt,previous});

test("Sunday's case comes from Saturday's real sales and is a complete daily case",()=>{
 const result=build('2026-10-04'),{puzzle}=result;
 expect(result.source).toBe('FRESH');expect(validatePuzzle(puzzle)).toEqual([]);
 expect(puzzle.file.mode).toBe('DAILY');expect(puzzle.file.day).toBe('2026-10-04');expect(puzzle.file.cast).toHaveLength(4);
 expect(puzzle.file.ruleLine).toBe('Two Chogs are lying. Present the receipts that prove it.');
 const sale=fixture.rows.find(row=>row.event.tx.toLowerCase()+':'+row.event.logIndex===result.event.sourceId)!;
 expect(sale.event.class).toBe('SALE');expect(new Date(source.times.get(sale.event.block)!*1000).toISOString().slice(0,10)).toBe('2026-10-03');
 expect(new Set(planFor(puzzle,null).lies.map(row=>row.witness)).size).toBe(2);
 for(const row of puzzleSources(puzzle))expect(source.times.get(row.block)!).toBeLessThan(puzzle.file.opensAt);
},120_000);

test('the same inputs always build the same case',()=>{
 expect(JSON.stringify(build('2026-10-04'))).toBe(JSON.stringify(build('2026-10-04')));
},120_000);

test('a Chog or wallet used in the previous seven cases is not chosen again',()=>{
 const first=build('2026-10-04'),second=build('2026-10-04',[first.event]);
 expect(second.event.tokenId).not.toBe(first.event.tokenId);
 for(const wallet of [first.event.from,first.event.to])expect([second.event.from,second.event.to]).not.toContain(wallet);
},120_000);

test('a day without a usable sale takes a cold case from an older real sale, never an empty day',()=>{
 const result=build('2026-10-20');
 expect(result.source).toBe('COLD_FALLBACK');expect(validatePuzzle(result.puzzle)).toEqual([]);
 const sale=fixture.rows.find(row=>row.event.tx.toLowerCase()+':'+row.event.logIndex===result.event.sourceId)!;
 expect(source.times.get(sale.event.block)!).toBeLessThan(Date.parse('2026-10-19T00:00:00Z')/1000);
 expect(result.puzzle.file.ruleLine).toBe('One Chog is lying. Present the receipt that proves it.');
},120_000);

test('an opted-out wallet never appears in a new case, as a party or as a witness holder',()=>{
 const first=build('2026-10-04'),optedOut=new Set([first.event.to.toLowerCase()]);
 const next=buildDailyPuzzle({...source,day:'2026-10-04',salt,previous:[],optedOut});
 expect([next.event.from,next.event.to].map(wallet=>wallet.toLowerCase())).not.toContain(first.event.to.toLowerCase());
 expect(next.rejected.some(row=>row.code==='CASE_OPTED_OUT')).toBe(true);
},120_000);
