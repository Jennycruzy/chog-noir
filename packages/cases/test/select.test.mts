import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import {saleCandidates,caseScore,priceGap,rankCandidates,type CaseRules} from '../src/select.mts';
const fixture=JSON.parse(await readFile(new URL('fixtures/sales.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const rules=JSON.parse(await readFile(new URL('../../../config/cases.json',import.meta.url),'utf8')) as CaseRules;
const times=new Map(fixture.times);
const sale=fixture.rows.find(row=>row.event.class==='SALE')!;
test('only exact source-backed sales enter the candidate pool',()=>{
 const candidates=saleCandidates(fixture.rows,times,rules);
 expect(candidates.length).toBeGreaterThan(0);
 expect(candidates.every(item=>item.row.event.class==='SALE'&&item.row.event.price?.status==='EXACT')).toBe(true);
 const unknown=structuredClone(sale);unknown.event.class='UNCLASSIFIED';
 const bundle=structuredClone(sale);bundle.event.price!.status='PRICE_BUNDLE';
 expect(saleCandidates([unknown],times,rules)).toEqual([]);
 expect(saleCandidates([bundle],times,rules)).toEqual([]);
 const self=structuredClone(sale);self.event.to=self.event.from;
 expect(saleCandidates([self],times,rules)).toEqual([]);
});
test('discount and premium boundaries compare full-precision base units',()=>{
 const row=structuredClone(sale);row.priorSaleMedianWei='100000000000000000001';row.holdSeconds=0;row.sources.arrival=null;
 row.event.price!.grossWei='90000000000000000001';
 expect(saleCandidates([row],times,rules).some(item=>item.type==='QUICK_EXIT')).toBe(false);
 row.event.price!.grossWei='90000000000000000000';
 expect(saleCandidates([row],times,rules).some(item=>item.type==='QUICK_EXIT')).toBe(true);
 row.event.route='listing_bought';row.event.price!.grossWei='120000000000000000001';
 expect(saleCandidates([row],times,rules).some(item=>item.type==='BIG_SPENDER')).toBe(false);
 row.event.price!.grossWei='120000000000000000002';
 expect(saleCandidates([row],times,rules).some(item=>item.type==='BIG_SPENDER')).toBe(true);
 row.event.route='offer_accepted';
 expect(saleCandidates([row],times,rules).some(item=>item.type==='BIG_SPENDER')).toBe(false);
});
test('a short hold after mint or a plain transfer is not a resale after buying',()=>{
 const row=structuredClone(sale);row.priorSaleMedianWei=null;row.holdSeconds=1;row.sources.arrival=null;
 expect(saleCandidates([row],times,rules).map(item=>item.type)).toEqual(['COLD_CASE']);
});
test('missing references do not invent a historical floor or a price gap',()=>{
 const row=structuredClone(sale);row.priorSaleMedianWei=null;row.sources.arrival=null;
 expect(saleCandidates([row],times,rules).some(item=>item.type==='BIG_SPENDER'||item.type==='QUICK_EXIT')).toBe(false);
 expect(priceGap(1n,null)).toBe(0);expect(priceGap(3n,1n)).toBe(1);
});
test('duplicate identities and absent block times fail closed',()=>{
 expect(()=>saleCandidates([sale,sale],times,rules)).toThrow('CASE_DUPLICATE');
 expect(()=>saleCandidates([sale],new Map(),rules)).toThrow('CASE_TIME');
});
test('score formula and seven-case repeat penalty are deterministic',()=>{
 expect(caseScore({rarity:1,priceGap:1,holdDrama:1,castQuality:1,freshness:1,repeatPenalty:0})).toBe(100);
 expect(()=>caseScore({rarity:NaN,priceGap:0,holdDrama:0,castQuality:0,freshness:0,repeatPenalty:0})).toThrow();
 const candidates=saleCandidates(fixture.rows,times,rules),day=new Date(candidates[0]!.at*1000).toISOString().slice(0,10);
 const context={day,previous:[],castQuality:()=>0};
 const first=rankCandidates(candidates,context);
 expect(rankCandidates([...candidates].reverse(),context)).toEqual(first);
 const target=first[0]!.candidate;
 const repeated=rankCandidates(candidates,{...context,previous:[{tokenId:target.row.event.tokenId,wallets:[]}]});
 expect(repeated.find(row=>row.candidate.id===target.id)!.score).toBeCloseTo(first[0]!.score-40);
 expect(()=>rankCandidates(candidates,{...context,day:'2026-02-30'})).toThrow('CASE_DAY');
});

test('yesterday’s subject loses priority to an otherwise slightly lower candidate',()=>{
 const candidates=saleCandidates(fixture.rows,times,rules),first=structuredClone(candidates[0]!),other=structuredClone(candidates.find(item=>item.row.event.tokenId!==first.row.event.tokenId)!);
 // Normalize score inputs to isolate the production ranking penalty.
 other.type=first.type;other.at=first.at;
 for(const candidate of [first,other]){candidate.row.priorSaleMedianWei=null;candidate.row.holdSeconds=0;}
 const day=new Date(first.at*1000).toISOString().slice(0,10),quality=(candidate:typeof first)=>candidate.id===first.id?1:0.9;
 expect(rankCandidates([first,other],{day,previous:[],castQuality:quality})[0]!.candidate.id).toBe(first.id);
 expect(rankCandidates([first,other],{day,previous:[{tokenId:first.row.event.tokenId,wallets:[]}],castQuality:quality})[0]!.candidate.id).toBe(other.id);
});
