import {privateOutput} from './private-output.mts';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { loadEnv } from './env.mts';
import { templateLine, validateLine, witnessPrompt, type WitnessInput, type WitnessLine } from '../packages/witness/src/lines.mts';
await loadEnv();
if (!process.env.ANTHROPIC_API_KEY) throw new Error('EVAL_KEY: Set ANTHROPIC_API_KEY in the local .env; no live model evaluation has run');
const root = new URL('../runs/witness-eval/',import.meta.url);
const corpus = JSON.parse(await readFile(new URL('corpus.json',root),'utf8')) as {rows:WitnessInput[]};
const digest = createHash('sha256').update(JSON.stringify(corpus.rows)+witnessPrompt).digest('hex');
if (corpus.rows.length < 300) throw new Error('EVAL_COVERAGE: At least 300 examples required');
const client = new Anthropic({maxRetries:0});
const model = 'claude-opus-5-5';
interface Result { attempts: {pass:boolean;refusal:boolean;errors:string[];output:unknown;usage:unknown}[]; final?:WitnessLine; fallback?:boolean }
interface State { digest:string; model:string; reservedDollars:number; batch:string|null; pending:string[]; results:Record<string,Result> }
let state:State;
try {state=JSON.parse(await readFile(new URL('state.json',root),'utf8'));}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={digest,model,reservedDollars:0,batch:null,pending:corpus.rows.map(row=>row.id),results:{}};}
if(state.digest!==digest||state.model!==model)throw new Error('EVAL_CHANGED: Corpus or prompt changed; use a separate evaluation directory before spending again');
async function save(){await writeFile(new URL('state.json.tmp',root),JSON.stringify(state,null,2));await rename(new URL('state.json.tmp',root),new URL('state.json',root));}
const params=(row:WitnessInput)=>({model,max_tokens:256,thinking:{type:'adaptive' as const},system:witnessPrompt,
  messages:[{role:'user' as const,content:JSON.stringify({card:row.card,persona:row.cleanPersona,displayFacts:row.displayFacts})}],
  output_config:{effort:'low' as const,format:{type:'json_schema' as const,schema:{type:'object',properties:{line:{type:'string'},facts_used:{type:'array',items:{type:'string'}}},required:['line','facts_used'],additionalProperties:false}}},
});
if(state.batch){
  const batch=await client.messages.batches.retrieve(state.batch);
  if(batch.processing_status!=='ended'){console.log(JSON.stringify({status:'PROCESSING',batch:state.batch,counts:batch.request_counts}));process.exit(0);}
  const seen=new Set<string>();
  for await(const item of await client.messages.batches.results(state.batch)){
    if(seen.has(item.custom_id)||!state.pending.includes(item.custom_id))throw new Error('EVAL_RESULT: Unexpected or repeated batch result');seen.add(item.custom_id);
    const row=corpus.rows.find(row=>row.id===item.custom_id)!;
    let output:unknown=null,errors:string[]=[],refusal=false,usage:unknown=null;
    if(item.result.type==='succeeded'){
      const message=item.result.message;usage=message.usage;refusal=message.stop_reason==='refusal';
      const text=message.content.filter(block=>block.type==='text').map(block=>block.text).join('');
      try{output=JSON.parse(text);errors=validateLine(row,output);}catch{errors=['INVALID_JSON'];}
      if(message.stop_reason!=='end_turn')errors.push(`STOP_${message.stop_reason}`);
    }else errors=[`API_${item.result.type}`];
    const result=state.results[row.id]??{attempts:[]};
    result.attempts.push({pass:errors.length===0&&!refusal,refusal,errors,output,usage});
    if(!errors.length&&!refusal)result.final=output as WitnessLine;
    else if(result.attempts.length>=3){result.final=templateLine(row);result.fallback=true;}
    state.results[row.id]=result;
  }
  if(seen.size!==state.pending.length)throw new Error('EVAL_RESULT: Missing batch results');
  state.pending=corpus.rows.filter(row=>!state.results[row.id]?.final).map(row=>row.id);state.batch=null;await save();
}
if(state.pending.length){
  const rows=corpus.rows.filter(row=>state.pending.includes(row.id));
  let inputTokens=0;
  for(const row of rows){const p=params(row);const count=await client.messages.countTokens({model,system:p.system,messages:p.messages,thinking:p.thinking,output_config:p.output_config});inputTokens+=count.input_tokens;}
  // Reserve full standard rates at $4/$20 per million, without assuming batch discounts.
  const reservation=inputTokens*4/1e6+rows.length*256*20/1e6;
  if(state.reservedDollars+reservation>5)throw new Error('EVAL_BUDGET: $5 hard reservation cap reached; previous results preserved');
  state.reservedDollars+=reservation;await save();
  const batch=await client.messages.batches.create({requests:rows.map(row=>({custom_id:row.id,params:params(row)}))});
  state.batch=batch.id;await save();
  console.log(JSON.stringify({status:'SUBMITTED',batch:batch.id,rows:rows.length,reservedDollars:state.reservedDollars,note:'Run this command again to collect. Generation runs in Anthropic batch infrastructure.'},null,2));
}else{
  const results=Object.values(state.results);
  const firstPass=results.filter(result=>result.attempts[0]?.pass).length;
  const refusalCount=results.flatMap(result=>result.attempts).filter(attempt=>attempt.refusal).length;
  const validFinal=corpus.rows.filter(row=>validateLine(row,state.results[row.id]?.final).length===0).length;
  const report={checkedAt:new Date().toISOString(),model,corpusDigest:digest,rows:corpus.rows.length,firstTryPass:firstPass,firstTryRate:firstPass/corpus.rows.length,
    finalPass:validFinal,fallbacks:results.filter(result=>result.fallback).length,refusals:refusalCount,
    automaticStatus:firstPass/corpus.rows.length>=0.98&&validFinal===corpus.rows.length&&refusalCount===0?'PASS':'FAIL',humanReview:'PENDING',status:'HUMAN_REVIEW_REQUIRED',reservedDollars:state.reservedDollars};

  await writeFile(await privateOutput('evals/witness-eval.json'),JSON.stringify(report,null,2));
  const review=Array.from({length:60},(_,index)=>{const row=corpus.rows[Math.floor(index*corpus.rows.length/60)]!;return {id:row.id,card:row.card,voice:row.voice,isPlannedLie:row.isLie,line:state.results[row.id]!.final!.line,displayFacts:row.displayFacts,good:null,offensive:null,comment:''};});
  // Never overwrite the human's ratings on a repeated collection command.
  try{await readFile(await privateOutput('evals/witness-review.json'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeFile(await privateOutput('evals/witness-review.json'),JSON.stringify({instructions:'Human review: set good and offensive to true/false for all 60 lines. Planned lies are intentional testimony for evaluation only. Target: at least 54 good, zero offensive.',rows:review},null,2));}
  console.log(JSON.stringify(report,null,2));
}
