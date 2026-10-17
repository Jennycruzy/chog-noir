import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {buildTemplateReview,gradeToneReview} from '../src/review.mts';
import {cards,voices,type WitnessInput} from '../src/lines.mts';
const inputs=JSON.parse(await readFile(new URL('fixtures/real-eval-inputs.json',import.meta.url),'utf8')) as WitnessInput[];
test('the sixty-line sample covers every card, voice and testimony type with unique sources',()=>{
 const review=buildTemplateReview(inputs);
 expect(review.rows).toHaveLength(60);expect(new Set(review.rows.map(row=>row.inputId)).size).toBe(60);
 for(const card of cards)expect(review.rows.filter(row=>row.card===card)).toHaveLength(6);
 for(const voice of voices)expect(review.rows.filter(row=>row.voice===voice)).toHaveLength(15);
 expect(review.rows.filter(row=>row.isPlannedLie)).toHaveLength(30);
 expect(gradeToneReview(review).status).toBe('PENDING');
});
test('unrated or partially rated lines can never pass',()=>{
 const review=buildTemplateReview(inputs);for(const row of review.rows.slice(0,59)){row.good=true;row.offensive=false;}
 expect(gradeToneReview(review).status).toBe('PENDING');
});
test('the required human threshold passes exactly at fifty-four good and zero offensive',()=>{
 const review=buildTemplateReview(inputs);review.rows.forEach((row,index)=>{row.good=index<54;row.offensive=false;});
 expect(gradeToneReview(review).status).toBe('PASS');expect(gradeToneReview(review).liveModelEvaluation).toBe('NOT_RUN');
 review.rows[53]!.good=false;expect(gradeToneReview(review).status).toBe('FAIL');
});
test('any offensive rating fails even when all lines are otherwise good',()=>{
 const review=buildTemplateReview(inputs);review.rows.forEach(row=>{row.good=true;row.offensive=false;});review.rows[0]!.offensive=true;
 expect(gradeToneReview(review).status).toBe('FAIL');
});
test('changing the reviewed line invalidates earlier ratings',()=>{
 const review=buildTemplateReview(inputs);review.rows[0]!.line+=' Changed.';expect(()=>gradeToneReview(review)).toThrow('TONE_CHANGED');
});
test('missing source combinations fail rather than inventing a review line',()=>{
 expect(()=>buildTemplateReview(inputs.filter(input=>input.card!=='ARRIVAL'))).toThrow('TONE_COVERAGE');
});
