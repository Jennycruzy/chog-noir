import { test, expect } from 'vitest';
import { voices, validateLine, witnessStatement } from '../src/lines.mts';

const fact = 'CHOG #368 was paid for with about 5,800 MON';
test('a line passes only when it carries exactly the given facts and no value of its own', () => {
  expect(validateLine({ displayFacts: [fact] }, { line: `I saw it plainly enough: ${fact}.`, facts_used: [fact] })).toEqual([]);
  expect(validateLine({ displayFacts: [fact] }, { line: `I saw it at 9 o'clock: ${fact}.`, facts_used: [fact] })).toContain('EXTRA_VALUE');
  expect(validateLine({ displayFacts: [fact] }, { line: 'I saw nothing.', facts_used: [fact] })).toContain('MISSING_FACT');
  expect(validateLine({ displayFacts: [fact] }, { line: `I saw it, guilty as sin: ${fact}.`, facts_used: [fact] })).toContain('BANNED_WORD');
  expect(validateLine({ displayFacts: [fact] }, { line: `I saw it. Really. Truly. ${fact}.`, facts_used: [fact] })).toContain('SENTENCES');
  expect(validateLine({ displayFacts: [fact] }, { line: `I saw it: ${fact}.`, facts_used: [] })).toContain('FACTS_USED');
  expect(validateLine({ displayFacts: [fact] }, { line: `I saw it: ${fact}.`, facts_used: [fact], extra: true })).toEqual(['INVALID_SCHEMA']);
});

test('every statement template keeps the fact verbatim, adds no value of its own and fits the length limit',()=>{
 // Real claim shapes: a self arrival, the longest wallet-move clause, and a price.
 const facts=['CHOG #1381 reached its new wallet on Thu 1 Oct, 01:11 UTC','CHOG #1381 moved from The Wandering Scarlet Messenger to The Northern Crimson Archivist',fact];
 const seen=new Set<string>();
 for(const purpose of ['opening','followup','retraction'] as const)for(const voice of voices)for(const self of [true,false])for(const value of facts)for(let seed=0;seed<12;seed++){
  const line=witnessStatement({fact:value,purpose,voice,self,seed:String(seed)});seen.add(line.replace(value,'{fact}'));
  expect(line.startsWith('I ')).toBe(true);expect(line.length).toBeLessThanOrEqual(140);expect(line).toContain(value);
  expect(validateLine({displayFacts:[value]},{line,facts_used:[value]})).toEqual([]);
 }
 expect(seen.size).toBeGreaterThanOrEqual(72);
 expect(()=>witnessStatement({fact:'x'.repeat(200),purpose:'opening',voice:'sharp',self:false,seed:'1'})).toThrow('too long');
});
