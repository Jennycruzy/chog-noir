import {readFile,writeFile} from 'node:fs/promises';
import {buildTemplateReview,gradeToneReview} from '../packages/witness/src/review.mts';
import type {WitnessInput} from '../packages/witness/src/lines.mts';
const path=new URL('../docs/evals/template-tone-review.json',import.meta.url);
if(process.argv.includes('--grade')){
 const review=JSON.parse(await readFile(path,'utf8')) as ReturnType<typeof buildTemplateReview>;
 const report={checkedAt:new Date().toISOString(),...gradeToneReview(review)};
 await writeFile(new URL('../docs/evals/template-tone-result.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}else{
 const corpus=JSON.parse(await readFile(new URL('../runs/witness-eval/corpus.json',import.meta.url),'utf8')) as {rows:WitnessInput[]};
 const review=buildTemplateReview(corpus.rows);
 try{await writeFile(path,JSON.stringify(review,null,2),{flag:'wx'});}catch(error){
  if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  if(!process.argv.includes('--refresh-unrated'))throw new Error('TONE_EXISTS: Review already exists; preserving human ratings');
  const previous=JSON.parse(await readFile(path,'utf8')) as ReturnType<typeof buildTemplateReview>;
  if(previous.rows.some(row=>row.good!==null||row.offensive!==null||row.comment.trim()))throw new Error('TONE_RATED: Refusing to overwrite human feedback');
  await writeFile(path,JSON.stringify(review,null,2));
 }
 const text=['# Fallback witness tone review','',
  'These 60 lines are written by deterministic templates from real source facts. They are not Claude output. Planned lies are explicitly marked and are for testimony evaluation only; their source facts remain unchanged. No line here is a published case.','',
  'Read each line and set `good` and `offensive` to true or false in `template-tone-review.json`. Leave a comment for any line that needs changing. Target: at least 54 good, zero offensive. Blank ratings remain pending.','',
  'Coverage: six lines per card; fifteen per voice; thirty true and thirty planned-false. Run `pnpm eval:tone:grade` after rating all rows. This does not pass the live model gate.',''];
 for(const row of review.rows){text.push(`## ${row.id} · ${row.card} · ${row.voice} · ${row.isPlannedLie?'PLANNED LIE':'TRUE'}`,'',`> ${row.line}`,'',`Source values: ${row.trueFacts.join(' | ')}`,'',`[View source transaction](https://monadscan.com/tx/${row.sources[0]!.tx})`,'');}
 await writeFile(new URL('../docs/evals/template-tone-review.md',import.meta.url),text.join('\n'));
 console.log(JSON.stringify(gradeToneReview(review),null,2));
}
