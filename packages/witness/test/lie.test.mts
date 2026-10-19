import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {draft as original} from '../../game/test/fixture.mts';
import {buildMemories,memoryLine,freezeMemories} from '../src/facts.mts';
import {planFullLie} from '../src/lie.mts';
import {validateCase,type Metadata} from '../../cases/src/build.mts';
import type {EnrichedEvent} from '../../core/src/enrich.mts';
const fixture=JSON.parse(await readFile(new URL('../../cases/test/fixtures/sales.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const saved=JSON.parse(await readFile(new URL('../../cases/test/fixtures/metadata.json',import.meta.url),'utf8')) as Record<string,Metadata>;
const metadata=new Map(Object.entries(saved).map(([id,item])=>[Number(id),structuredClone(item)]));
const draft=structuredClone(original);draft.private.facts=buildMemories(draft,fixture.rows,new Map(fixture.times),metadata);
test('a planned card lie has one exact source-backed contradiction and retains three valid questions',()=>{
 const modified=new Map([...metadata].map(([id,item])=>[id,{...item,attributes:item.attributes.map(trait=>trait.trait_type==='Eyes'?{...trait,value:'Side Eye'}:trait)}]));
 const next=planFullLie(draft,modified),lie=next.private.key.lie;
 expect(validateCase(next)).toEqual([]);expect(['OWNER_COUNT','LAST_NIGHT','LONGEST_HOLD']).toContain(lie.card);
 expect(memoryLine(next,lie.witness,lie.card).line).toContain(lie.claim);
 expect(next.public.ledger.find(item=>item.id===lie.ledgerId)!.text).toContain(lie.truth);
 expect(next.public.ledger.some(item=>item.text.includes(lie.claim))).toBe(false);
 expect(next.public.ledger.filter(item=>item.sealed)).toHaveLength(2);
});
test('planning a new daily lie cannot mutate an archived commitment or source memories',()=>{
 const snapshot=structuredClone(draft);planFullLie(draft,metadata);expect(draft).toEqual(snapshot);
});
test('source-free planning fails instead of generating witness facts',()=>{
 expect(()=>planFullLie(original,metadata)).toThrow('Build source-backed');
});

test('salt-selected fallback lies vary cards and count direction without negative values',()=>{
 const neutral=new Map([...metadata].map(([id,item])=>[id,{...item,attributes:item.attributes.map(trait=>['Eyes','Mouth','Form'].includes(trait.trait_type)?{...trait,value:'Plain'}:trait)}]));
 const cards=new Set<string>(),witnesses=new Set<number>(),deltas=new Set<number>();
 for(let seed=0;seed<40;seed++){
  const source=structuredClone(draft);source.private.salt='0x'+seed.toString(16).padStart(64,'0');
  const next=planFullLie(source,neutral),lie=next.private.key.lie;
  cards.add(lie.card);witnesses.add(lie.witness);
  const truth=Number(lie.truth.match(/\d+/)![0]),claim=Number(lie.claim.match(/\d+/)![0]);
  expect(claim).toBeGreaterThanOrEqual(0);expect([1,2]).toContain(Math.abs(claim-truth));deltas.add(Math.sign(claim-truth));
  const line=memoryLine(next,lie.witness,lie.card).line;expect(line).toContain(lie.claim);expect(line).not.toContain(lie.truth);
 }
 expect(cards.size).toBe(3);expect(witnesses.size).toBeGreaterThan(1);expect(deltas).toContain(1);expect(deltas).toContain(-1);
});

test('a frozen archive case can seed a new lie without stale lines or duplicate records',()=>{
 const first=planFullLie(draft,metadata);freezeMemories(first);
 const next=planFullLie(first,metadata),lie=next.private.key.lie;
 expect(validateCase(next)).toEqual([]);
 expect(new Set(next.public.ledger.map(item=>item.id)).size).toBe(next.public.ledger.length);
 expect(memoryLine(next,lie.witness,lie.card).line).toContain(lie.claim);
 expect(next.public.ledger.filter(item=>item.sealed)).toHaveLength(2);
});
