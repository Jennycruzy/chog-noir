import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {draft as original} from '../../game/test/fixture.mts';
import {buildMemories,memoryLine,nativeBand} from '../src/facts.mts';
import {cards} from '../src/lines.mts';
import type {Metadata} from '../../cases/src/build.mts';
import type {EnrichedEvent} from '../../core/src/enrich.mts';
const fixture=JSON.parse(await readFile(new URL('../../cases/test/fixtures/sales.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const saved=JSON.parse(await readFile(new URL('../../cases/test/fixtures/metadata.json',import.meta.url),'utf8')) as Record<string,Metadata>;
const metadata=new Map(Object.entries(saved).map(([id,item])=>[Number(id),item]));
const times=new Map(fixture.times),draft=structuredClone(original);
draft.private.facts=buildMemories(draft,fixture.rows,times,metadata);
test('all ten cards have bounded source records for every witness',()=>{
 for(const witness of draft.public.cast)for(const card of cards){
  const fact=draft.private.facts![witness.tokenId]!.cards[card];expect(fact.sources.length).toBeGreaterThan(0);
  expect(fact.sources.every(source=>source.block<=draft.private.facts![witness.tokenId]!.cutoff.block)).toBe(true);
  expect(memoryLine(draft,witness.tokenId,card).line.length).toBeLessThanOrEqual(160);
  expect(memoryLine(draft,witness.tokenId,card,true).line.length).toBeLessThanOrEqual(160);
 }
});
test('future transfers cannot change witness memories or roommates',()=>{
 const row=structuredClone(fixture.rows.at(-1)!);row.event.block=draft.private.facts![draft.public.subject.tokenId]!.cutoff.block+100_000;row.event.logIndex=99999;
 const future=new Map(times);future.set(row.event.block,Date.parse(draft.public.occurredAt)/1000+86400);
 expect(buildMemories(draft,[...fixture.rows,row],future,metadata)).toEqual(draft.private.facts);
});
test('only the planned witness/card swaps an arrival date',()=>{
 const lie=draft.private.key.lie;
 expect(memoryLine(draft,lie.witness,'ARRIVAL').line).toContain(lie.claim);
 expect(draft.private.facts![lie.witness]!.cards.ARRIVAL.detail).toContain(lie.truth);
 for(const witness of draft.public.cast)if(witness.tokenId!==lie.witness)expect(memoryLine(draft,witness.tokenId,'ARRIVAL').line).toContain(draft.private.facts![witness.tokenId]!.cards.ARRIVAL.detail);
});
test('verified price is banded unless exact-price access is granted',()=>{
 const witness=draft.public.subject.tokenId,fact=draft.private.facts![witness]!.cards.PRICE_TALK;
 expect(fact.exactDetail).toBeTruthy();expect(memoryLine(draft,witness,'PRICE_TALK').exact).toBe(false);
 expect(memoryLine(draft,witness,'PRICE_TALK',true).line).toContain(fact.exactDetail!);
 expect(memoryLine(draft,witness,'PRICE_TALK',true).exact).toBe(true);
 expect(nativeBand(3999n*10n**18n)).toBe('below 4,000 MON');expect(nativeBand(4000n*10n**18n)).toBe('4,000–4,999 MON');
});
test('a missing source timestamp fails instead of inventing a witness memory',()=>{
 expect(()=>buildMemories(draft,fixture.rows,new Map(),metadata)).toThrow('WITNESS_TIME');
});
