import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { cards, voices, templateLine, validateLine, type WitnessInput } from '../src/lines.mts';
const inputs = JSON.parse(await readFile(new URL('fixtures/real-eval-inputs.json',import.meta.url),'utf8')) as WitnessInput[];
const input = inputs.find(row => row.card==='PRICE_TALK'&&!row.isLie)!;
const output = templateLine(input);
test('all card/voice/truth combinations have valid sourced fallback lines',()=>{
  expect(inputs).toHaveLength(80);
  for(const card of cards)for(const voice of voices)for(const isLie of [true,false]){
    const row=inputs.find(row=>row.card===card&&row.voice===voice&&row.isLie===isLie)!;
    expect(row).toBeDefined();expect(row.sources.length).toBeGreaterThan(0);
    for(let variant=0;variant<3;variant++)expect(validateLine(row,templateLine(row,variant))).toEqual([]);
  }
});
test('planned false testimony differs from true facts while sources retain real identities',()=>{
  for(const row of inputs){expect(row.displayFacts.join('|')===row.trueFacts.join('|')).toBe(!row.isLie);for(const src of row.sources)expect(src.tx).toMatch(/^0x[0-9a-f]{64}$/);}
});
test('clean personas do not include the crude labels',()=>{for(const row of inputs)expect(row.cleanPersona).not.toMatch(/boob|milf|retard|horny|boner|\bbbc\b|thots|buttcoin/i);});
test('a changed price is rejected even when facts_used claims the right facts',()=>{
  const wrong={...output,line:output.line.replace(input.displayFacts[1]!,'123 MON')};
  expect(validateLine(input,wrong)).toContain('MISSING_FACT');expect(validateLine(input,wrong)).toContain('EXTRA_VALUE');
});
test('additional Chog names are rejected',()=>{expect(validateLine(input,{...output,line:output.line+' CHOG #1969'})).toContain('EXTRA_VALUE');});
test('additional dates and addresses are rejected',()=>{for(const extra of ['2026-10-17','0x1234…abcd'])expect(validateLine(input,{...output,line:output.line+' '+extra})).toContain('EXTRA_VALUE');});
test('invented numeric words are rejected',()=>{expect(validateLine(input,{...output,line:output.line+' Two wallets.'})).toContain('EXTRA_VALUE');});
test('missing or duplicated facts_used are rejected',()=>{
  for(const facts_used of [[],[...output.facts_used,output.facts_used[0]!]])expect(validateLine(input,{...output,facts_used})).toContain('FACTS_USED');
});
test('banned and crude words are rejected',()=>{for(const word of ['guilty','court','horny','retard','AI-powered'])expect(validateLine(input,{...output,line:output.line+' '+word})).toContain('BANNED_WORD');});
test('overlong and empty responses are rejected',()=>{for(const line of ['','a'.repeat(161)])expect(validateLine(input,{...output,line})).toContain('LENGTH');});
test('three sentences are rejected',()=>{expect(validateLine(input,{...output,line:input.displayFacts.join('; ')+'. The rain fell. The lamp dimmed.'})).toContain('SENTENCES');});
test('malformed and extra output fields fail schema checks',()=>{for(const value of [null,{},'text',{...output,extra:true},{...output,facts_used:[42]}])expect(validateLine(input,value)).toContain('INVALID_SCHEMA');});
