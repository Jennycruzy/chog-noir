import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import {saleCandidates,type CaseRules} from '../src/select.mts';
import {buildCase,buildCast,validateCase,verifyCaseSources,answerHash,canonicalJSON,type Metadata} from '../src/build.mts';
const fixture=JSON.parse(await readFile(new URL('fixtures/sales.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const saved=JSON.parse(await readFile(new URL('fixtures/metadata.json',import.meta.url),'utf8')) as Record<string,Metadata>;
const metadata=new Map(Object.entries(saved).map(([id,data])=>[Number(id),data])),times=new Map(fixture.times);
const rules=JSON.parse(await readFile(new URL('../../../config/cases.json',import.meta.url),'utf8')) as CaseRules;
const candidate=saleCandidates(fixture.rows,times,rules).at(-1)!;
const salt='0x'+'ab'.repeat(32);
const build=()=>buildCase(candidate,fixture.rows,times,metadata,rules,salt);
test('a real sale builds three four-option questions, a source ledger and one catchable lie',()=>{
 const draft=build();expect(validateCase(draft)).toEqual([]);
 expect(draft.public.questions).toHaveLength(3);
 for(const question of draft.public.questions){expect(question.options).toHaveLength(4);expect(new Set(question.options.map(item=>item.value)).size).toBe(4);}
 expect(draft.public.testimony.filter(item=>item.line.includes(draft.private.key.lie.claim))).toHaveLength(1);
 expect(draft.public.ledger.every(item=>!item.text.includes(draft.private.key.lie.claim))).toBe(true);
 expect(draft.public.ledger.filter(item=>item.sealed)).toHaveLength(2);
 expect(draft.public.cast.every(item=>item.arrival.block<=candidate.row.event.block)).toBe(true);
 expect(JSON.stringify(draft.public)).not.toContain('"salt"');expect(JSON.stringify(draft.public)).not.toContain('"key"');
});
test('replays retain identical questions, testimony and commitments',()=>{
 expect(buildCase(candidate,[...fixture.rows].reverse(),times,metadata,rules,salt)).toEqual(build());
 expect(answerHash('another-case',build().private.key,salt)).not.toBe(build().public.answerHash);
 expect(()=>answerHash('case',build().private.key,'0x00')).toThrow('CASE_SALT');
 expect(canonicalJSON({b:2,a:1})).toBe(canonicalJSON({a:1,b:2}));
});
test('a changed key fails both commitment and ledger-answer checks',()=>{
 const draft=build(),question=draft.public.questions[0]!;
 draft.private.key.answers[question.id]=question.options.find(option=>option.id!==draft.private.key.answers[question.id])!.id;
 expect(validateCase(draft)).toContain('HASH');expect(validateCase(draft)).toContain('ANSWER');
 draft.public.answerHash=answerHash(draft.public.id,draft.private.key,salt);
 expect(validateCase(draft)).toContain('ANSWER');
});
test('future events cannot enter cast or distractor choices',()=>{
 const baseline=build(),future=structuredClone(candidate.row);future.event.block+=100;future.event.logIndex+=1;future.event.tokenId=1969;
 const nextTimes=new Map(times);nextTimes.set(future.event.block,candidate.at+86400);
 expect(buildCase(candidate,[...fixture.rows,future],nextTimes,metadata,rules,salt)).toEqual(baseline);
});
test('tampering with the selected sale or losing metadata fails closed',()=>{
 const altered=structuredClone(candidate);altered.row.event.price!.grossWei='1';
 expect(()=>buildCase(altered,fixture.rows,times,metadata,rules,salt)).toThrow('CASE_SOURCE');
 expect(()=>buildCast(candidate,fixture.rows,times,new Map())).toThrow('CASE_CAST_SOURCE');
});
test('rebuilding from original sources rejects edited ledger text even with an intact key',()=>{
 const draft=build(),candidates=saleCandidates(fixture.rows,times,rules);
 expect(verifyCaseSources(draft,candidates,fixture.rows,times,metadata,rules)).toEqual([]);
 draft.public.ledger[0]!.text='A different Chog changed hands.';
 expect(verifyCaseSources(draft,candidates,fixture.rows,times,metadata,rules)).toEqual(['SOURCE_MISMATCH']);
});
