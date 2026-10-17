import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import type {EnrichedEvent} from '../packages/core/src/enrich.mts';
import {saleCandidates,rankCandidates,type CaseRules} from '../packages/cases/src/select.mts';
import {buildCase,buildCast,castQuality,validateCase,verifyCaseSources,canonicalJSON,type CaseDraft,type Metadata} from '../packages/cases/src/build.mts';
const root=new URL('../',import.meta.url),directory=new URL('runs/case-engine/',root);
const [enrichedRaw,historyRaw,rulesRaw]=await Promise.all(['runs/classification/enriched.json','data/related/history.json','config/cases.json'].map(path=>readFile(new URL(path,root),'utf8')));
const rows=(JSON.parse(enrichedRaw!) as {events:EnrichedEvent[]}).events;
const blocks=(JSON.parse(historyRaw!) as {data:{blocks:{number:number;timestamp:number}[]}}).data.blocks;
const rules=JSON.parse(rulesRaw!) as CaseRules,times=new Map(blocks.map(block=>[block.number,block.timestamp]));
const metadata=new Map<number,Metadata>();
for(let start=1;start<=1969;start+=64){
 await Promise.all(Array.from({length:Math.min(64,1970-start)},async(_,offset)=>{const id=start+offset;const saved=JSON.parse(await readFile(new URL(`data/metadata/${id}.json`,root),'utf8'));metadata.set(id,saved.metadata as Metadata);}));
}
const inputHash=createHash('sha256').update(canonicalJSON({rows,blocks,rules,metadata:[...metadata].sort(([a],[b])=>a-b)})).digest('hex');
const candidates=saleCandidates(rows,times,rules);
const end=Math.floor(Math.max(...rows.map(row=>times.get(row.event.block)!))/86400)*86400;
let existing:CaseDraft[]=[],previousArchive:string|null=null;
try{previousArchive=await readFile(new URL('archive.json',directory),'utf8');existing=(JSON.parse(previousArchive) as {cases:CaseDraft[]}).cases;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const verifyReplay=process.argv.includes('--verify-replay');
if(verifyReplay&&previousArchive===null)throw new Error('CASE_REPLAY: No existing archive to verify');
const salts=new Map(existing.map(draft=>[draft.public.id,draft.private.salt])),cases:CaseDraft[]=[],selections=[];
const previous:{tokenId:number;wallets:string[]}[]=[],rejected:{candidateId:string;reason:string}[]=[];
for(let offset=rules.archiveQueueSize;offset>=1;offset--){
 const day=new Date((end-offset*86400)*1000).toISOString().slice(0,10);
 const ranked=rankCandidates(candidates,{day,previous,castQuality:candidate=>castQuality(buildCast(candidate,rows,times,metadata),metadata)});
 let selected:CaseDraft|undefined;
 for(const row of ranked){
  const id=`sale-${row.candidate.row.event.block}-${row.candidate.row.event.logIndex}-${row.candidate.type.toLowerCase()}`;
  try{
   const draft=buildCase(row.candidate,rows,times,metadata,rules,salts.get(id)??`0x${randomBytes(32).toString('hex')}`);
   const errors=[...validateCase(draft),...verifyCaseSources(draft,candidates,rows,times,metadata,rules)];if(errors.length)throw new Error(`CASE_VALIDATION: ${errors.join(',')}`);
   selected=draft;selections.push({day,caseId:id,score:row.score,components:row.components});
   previous.push({tokenId:row.candidate.row.event.tokenId,wallets:[row.candidate.row.event.from,row.candidate.row.event.to]});break;
  }catch(error){const reason=(error as Error).message;if(!/^CASE_(OPTIONS|CAST|LIE):/.test(reason))throw error;rejected.push({candidateId:row.candidate.id,reason});}
 }
 if(!selected)throw new Error(`CASE_COVERAGE: No valid source-backed case for ${day}; no fictional replacement created`);
 cases.push(selected);
 console.log(JSON.stringify({stage:'CASE_BUILT',day,caseId:selected.public.id,queued:cases.length}));
}
await mkdir(directory,{recursive:true});
const nextArchive=JSON.stringify({inputHash,selections,cases},null,2);
if(verifyReplay&&nextArchive!==previousArchive)throw new Error('CASE_REPLAY: Rebuilt archive differs from the saved cases');
await writeFile(new URL('archive.json.tmp',directory),nextArchive,{mode:0o600});
await rename(new URL('archive.json.tmp',directory),new URL('archive.json',directory));
await writeFile(new URL('inputs.json',directory),JSON.stringify({inputHash,config:rules,historyEvents:rows.length,coverageEndExclusive:new Date(end*1000).toISOString(),rejected},null,2));
const report={checkedAt:new Date().toISOString(),status:'DRAFT_ARCHIVE_VALIDATED',inputHash,replayVerified:verifyReplay,cases:cases.length,days:selections.map(item=>item.day),candidateCounts:Object.fromEntries([...new Set(candidates.map(item=>item.type))].sort().map(type=>[type,candidates.filter(item=>item.type===type).length])),selectedTypes:Object.fromEntries([...new Set(cases.map(item=>item.public.type))].sort().map(type=>[type,cases.filter(item=>item.public.type===type).length])),questions:cases.reduce((sum,item)=>sum+item.public.questions.length,0),testimonySource:'VALIDATED_TEMPLATES',plannedLies:cases.length,sourceWindowEndExclusive:new Date(end*1000).toISOString(),publicGamePublished:false,onchainCommitment:'NOT_SUBMITTED',humanReview:'PENDING',rejectedCandidates:rejected.length};
await mkdir(new URL('docs/cases/',root),{recursive:true});
const lines=['# Archive case review','','These are source-backed drafts for review, with answer spoilers below each case. They are not live daily cases. Dialogue uses deterministic templates; no Claude generation or human approval is claimed. Prices are gross payments including fees. MON and WMON use the same native-unit bands. The recent reference is a seven-sale median, not a historical floor quote.','','Only the sale-based Quick Exit, Big Spender, Long Goodbye and general archive builders are implemented here. Other case families, final partner-group approval, interactive play and on-chain publication remain separate work.',''];
for(const [index,draft] of cases.entries()){
 const pub=draft.public;
 lines.push(`## ${index+1}. ${pub.subject.name} — ${pub.type.replaceAll('_',' ')}`,'',`Selection day: ${selections[index]!.day}. Recorded event: ${pub.occurredAt}.`, '',pub.trigger,'','Witnesses: '+pub.cast.map(member=>`${member.name} (${member.role.toLowerCase().replaceAll('_',' ')})`).join('; ')+'.','','### Testimony','');
 for(const testimony of pub.testimony)lines.push(`- ${metadata.get(testimony.tokenId)!.name}: “${testimony.line}”`);
 lines.push('','### Ledger','');
 for(const fact of pub.ledger)lines.push(`- ${fact.sealed?'**Starts sealed.** ':''}${fact.text} ${fact.sources.map((src,index)=>`[Source ${index+1}](https://monadscan.com/tx/${src.tx}#eventlog) (block ${src.block}, log ${src.logIndex})`).join('; ')}`);
 lines.push('','### Questions','');
 for(const [number,question] of pub.questions.entries()){
  lines.push(`${number+1}. ${question.prompt}`,'');
  for(const [optionIndex,option] of question.options.entries())lines.push(`   - **${String.fromCharCode(65+optionIndex)}.** ${option.label}`);
  lines.push('');
 }
 lines.push('<details>','<summary>Answer key and planned lie</summary>','');
 for(const question of pub.questions){const index=question.options.findIndex(option=>option.id===draft.private.key.answers[question.id]);lines.push(`- ${question.id}: ${String.fromCharCode(65+index)} — ${question.options[index]!.label}. Ledger: ${question.ledgerId}.`);}
 lines.push(`- Planned lie: ${metadata.get(draft.private.key.lie.witness)!.name} claims arrival on ${draft.private.key.lie.claim}. The source-linked ledger proves ${draft.private.key.lie.truth}.`,'','</details>','');
}
await writeFile(new URL('docs/cases/archive-review.md',root),lines.join('\n'));
await writeFile(new URL('docs/audit/evidence/case-archive.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
