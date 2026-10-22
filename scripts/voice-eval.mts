import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {loadEnv} from './env.mts';
import type {Metadata} from '../packages/cases/src/build.mts';
import type {PuzzleCase} from '../packages/cases/src/puzzle.mts';
import {WitnessVoice,caseVoiceRequests,personaOf,reserveFor,acceptLine,type VoiceRequest} from '../packages/witness/src/voice.mts';
import {witnessStatement} from '../packages/witness/src/lines.mts';
import {privateOutput} from './private-output.mts';

// The one-time voice evaluation: Claude Opus 5.5 words the statements of the archived real cases, once, inside the
// $2 Opus allowance. Without a flag it only prints what it would send and the most it could cost.
//   tsx scripts/voice-eval.mts <cases.json>            plan only, nothing is sent
//   tsx scripts/voice-eval.mts <cases.json> --submit   send the batch (the exact command must be approved first)
//   tsx scripts/voice-eval.mts <cases.json> --collect  write the rating sheet once the batch has ended
await loadEnv();
const root=fileURLToPath(new URL('../',import.meta.url)),model='claude-opus-5-5',[file,mode]=process.argv.slice(2);
if(!file)throw new Error('VOICE_EVAL_INPUT: Pass the private case-reading file');
const cases=(JSON.parse(await readFile(file,'utf8')) as {cases:{label:string;puzzle:PuzzleCase}[]}).cases;
const metadata=new Map<number,Metadata>();
for(const id of new Set(cases.flatMap(row=>row.puzzle.file.cast.map(member=>member.tokenId))))metadata.set(id,JSON.parse(await readFile(`${root}data/metadata/${id}.json`,'utf8')).metadata);
// Unique requests across all cases; the same fact in the same voice is asked once.
const unique=new Map<string,{label:string;request:VoiceRequest}>();
for(const {label,puzzle} of cases){const personas=new Map(puzzle.file.cast.map(row=>[row.tokenId,personaOf(metadata.get(row.tokenId)!)]));for(const row of caseVoiceRequests(puzzle,personas))unique.set(JSON.stringify(row.request),{label,request:row.request});}
const requests=[...unique.values()];
const voice=new WitnessVoice({root,client:mode&&process.env.ANTHROPIC_API_KEY?new Anthropic().messages.batches:null});
if(!mode){console.log(JSON.stringify({model,cases:cases.length,requests:requests.length,worstCaseUsd:Number(reserveFor(model,requests.map(row=>row.request)).toFixed(4)),...await voice.spend()},null,2));process.exit(0);}
if(mode==='--submit'){console.log(JSON.stringify({batch:await voice.submit(model,requests.map(row=>row.request))}));process.exit(0);}
if(mode!=='--collect')throw new Error('VOICE_EVAL_MODE: Use --submit or --collect');
const report=await voice.collect(),rows=[];
for(const {label,request} of requests){const voiced=await voice.voiced(model,request),line=await voice.line(model,request,'eval');rows.push({label,purpose:request.purpose,voice:request.voice,fact:request.fact,template:witnessStatement({...request,seed:'eval'}),line:voiced?line:null,checks:voiced?acceptLine(request,{line,facts_used:[request.fact]}):['NOT_VOICED']});}
const voicedRows=rows.filter(row=>row.line),sample=voicedRows.filter((_,index)=>index%Math.max(1,Math.floor(voicedRows.length/60))===0).slice(0,60);
const path=await privateOutput(`evals/voice-${new Date().toISOString().slice(0,10)}.md`);
await writeFile(path,[`# Witness voice evaluation (${model})`,'',`Requests ${rows.length}; voiced and valid ${voicedRows.length} (${Math.round(voicedRows.length*100/rows.length)}% first-try pass); spend ${JSON.stringify(await voice.spend())}`,'',
 '## Lines to rate (1 = flat, 5 = great; mark any wrong fact)','',...sample.map((row,index)=>`${index+1}. [${row.label} · ${row.purpose} · ${row.voice}] ${row.line}\n   template: ${row.template}\n   rating: `)].join('\n'),{mode:0o600});
console.log(JSON.stringify({...report,sheet:path,voiced:voicedRows.length,requests:rows.length}));
