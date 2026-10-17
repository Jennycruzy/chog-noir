import {createHash} from 'node:crypto';
import {cards,voices,templateLine,type WitnessInput} from './lines.mts';
export interface ToneReviewRow {
 id:string; inputId:string; card:typeof cards[number]; voice:typeof voices[number]; isPlannedLie:boolean;
 line:string; displayFacts:string[]; trueFacts:string[]; sources:WitnessInput['sources'];
 good:boolean|null; offensive:boolean|null; comment:string;
}
export function buildTemplateReview(inputs:WitnessInput[]) {
 const starts=[0,2,1,3,2,0,3,1,0,2];
 const used=new Set<string>();
 const rows:ToneReviewRow[]=[];
 for(let cardIndex=0;cardIndex<cards.length;cardIndex++)for(let sample=0;sample<6;sample++){
  const card=cards[cardIndex]!,voice=voices[(starts[cardIndex]!+sample)%4]!,isLie=sample<4?sample%2===1:sample%2===0;
  const input=inputs.find(input=>input.card===card&&input.voice===voice&&input.isLie===isLie&&!used.has(input.id));
  if(!input)throw new Error('TONE_COVERAGE: Missing unique real-source example');used.add(input.id);
  const output=templateLine(input,sample%3);
  rows.push({id:`T${String(rows.length+1).padStart(2,'0')}`,inputId:input.id,card,voice,isPlannedLie:isLie,
   line:output.line,displayFacts:input.displayFacts,trueFacts:input.trueFacts,sources:input.sources,good:null,offensive:null,comment:''});
 }
 const digest=createHash('sha256').update(JSON.stringify(rows.map(({good,offensive,comment,...row})=>row))).digest('hex');
 return {version:1,generator:'deterministic_templates' as const,model:null,digest,scope:'Fallback tone review only; not a live Claude evaluation or an A6/A7 pass.',rows};
}
export function gradeToneReview(review:ReturnType<typeof buildTemplateReview>) {
 if(review.generator!=='deterministic_templates'||review.model!==null||review.rows.length!==60||new Set(review.rows.map(row=>row.id)).size!==60)throw new Error('TONE_INPUT: Expected 60 unique template review rows');
 const digest=createHash('sha256').update(JSON.stringify(review.rows.map(({good,offensive,comment,...row})=>row))).digest('hex');
 if(digest!==review.digest)throw new Error('TONE_CHANGED: Reviewed text or sources changed');
 for(const row of review.rows)if(![true,false,null].includes(row.good)||![true,false,null].includes(row.offensive))throw new Error('TONE_RATING: Use true, false or null');
 const rated=review.rows.filter(row=>typeof row.good==='boolean'&&typeof row.offensive==='boolean').length;
 const good=review.rows.filter(row=>row.good===true).length,offensive=review.rows.filter(row=>row.offensive===true).length;
 return {scope:review.scope,digest:review.digest,reviewed:rated,total:60,good,offensive,
  status:rated!==60?'PENDING':good>=54&&offensive===0?'PASS':'FAIL',liveModelEvaluation:'NOT_RUN'};
}
