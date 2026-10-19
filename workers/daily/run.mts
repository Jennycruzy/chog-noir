import {mkdir,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isAddress,createPublicClient,http} from 'viem';
import {monad} from '../../packages/chain/src/client.mts';
import type {StoredHistory} from '../../scripts/data-types.mts';
import type {EnrichedEvent} from '../../packages/core/src/enrich.mts';
import {loadEnv} from '../../scripts/env.mts';
import {collectDaily} from './collect.mts';
import {recoverDailySource,dailySources,sourceCaseId,type SavedPlan} from './plan.mts';
import {saleCandidates,rankCandidates,type CaseRules} from '../../packages/cases/src/select.mts';
import {buildCase,buildCast,castQuality,validateCase,verifyCaseSources,bindCaseContent,type CaseDraft,type Metadata} from '../../packages/cases/src/build.mts';
import {buildMemories,memoryLine,freezeMemories} from '../../packages/witness/src/facts.mts';
import {cards} from '../../packages/witness/src/lines.mts';
import {planFullLie} from '../../packages/witness/src/lie.mts';
import {localVault,privateVaultKeyFile,atomicJSON} from '../../packages/publishing/src/vault.mts';
import {Publisher,dailyDraft,type Publication} from '../../packages/publishing/src/publish.mts';
import {casebookChain} from '../../packages/chain/src/client.mts';
import {safeError} from '../../scripts/errors.mts';
await loadEnv();
if(process.env.CHOG_CHAIN_LOCKED!=='true')throw new Error('DAILY_LOCK: Run through corepack pnpm daily:run or the systemd service');
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=join(root,'runs/daily');await mkdir(join(directory,'plans'),{recursive:true,mode:0o700});
const now=new Date(),day=now.toISOString().slice(0,10),sourceDay=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const vault=await localVault(join(root,'runs/publication-vault'),privateVaultKeyFile());
const statusPath=join(directory,'status.json');
interface Plan extends SavedPlan {sourceDay:string;opensAt:number;closesAt:number;toBlockExclusive:number;condition?:'DEGRADED';reason?:string}
try{
 let activePublisher:Publisher|null=null;
 const configuredAddress=process.env.CASEBOOK_ADDRESS;
 if(configuredAddress&&isAddress(configuredAddress)&&process.env.SERVER_PRIVATE_KEY&&process.env.EXECUTION_WRITES_ENABLED==='true'){
  activePublisher=new Publisher(join(root,'runs/publications'),vault,await casebookChain(root,configuredAddress));
  await mkdir(join(root,'runs/publications'),{recursive:true,mode:0o700});
  for(const file of (await readdir(join(root,'runs/publications'))).filter(file=>/^\d{4}-\d{2}-\d{2}-(main|cold)\.json$/.test(file))){const old=await activePublisher.read(file.slice(0,-5));if(old?.open&&old.closesAt<=Date.now()/1000&&old.status!=='COMPLETE')await activePublisher.close(old.id);}
 }
 let plan:Plan|null=null;
 try{plan=JSON.parse(await readFile(join(directory,'plans',day+'.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(!plan){
  await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:'BUILDING',day,sourceDay});
  const recovery=await recoverDailySource(()=>collectDaily(root,Math.max(Date.parse(day+'T00:10:00Z'),Date.now()+30_000)),async()=>{
   const snapshot=JSON.parse(await readFile(join(root,'data/related/history.json'),'utf8')) as StoredHistory;
   const enriched=JSON.parse(await readFile(join(root,'runs/classification/enriched.json'),'utf8')) as {events:EnrichedEvent[]};
   return {history:enriched.events,times:new Map(snapshot.data.blocks.map(block=>[block.number,block.timestamp])),coverageAt:Math.max(...snapshot.data.blocks.map(block=>block.timestamp)),rpc:createPublicClient({chain:monad,transport:http(process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz',{timeout:30_000})}),data:snapshot.data,toBlockExclusive:snapshot.toBlockExclusive};
  },day);
  const {data,fresh}=recovery;
  if(recovery.degraded)console.error('DAILY_DEGRADED',safeError(new Error(recovery.reason!)));
  const metadata=new Map<number,Metadata>();
  for(let start=1;start<=1969;start+=64)await Promise.all(Array.from({length:Math.min(64,1970-start)},async(_,offset)=>{const id=start+offset;metadata.set(id,JSON.parse(await readFile(join(root,`data/metadata/${id}.json`),'utf8')).metadata);}));
  const rules=JSON.parse(await readFile(join(root,'config/cases.json'),'utf8')) as CaseRules;
  const candidates=saleCandidates(data.history,data.times,rules),previous:{tokenId:number;wallets:string[]}[]=[];
  try{for(const file of (await readdir(join(root,'runs/publications'))).filter(file=>file.endsWith('-main.json')).sort()){const record=JSON.parse(await readFile(join(root,'runs/publications',file),'utf8')) as Publication;if(!record.publishedAt)continue;const old=await vault.load(record.id);previous.push({tokenId:old.public.subject.tokenId,wallets:old.public.ledger.filter(fact=>fact.id==='seller'||fact.id==='buyer').map(fact=>fact.text.match(/0x[0-9a-f]{40}/i)?.[0]).filter((value):value is string=>!!value)});}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  previous.splice(0,Math.max(0,previous.length-7));
  const ranked=fresh?rankCandidates(candidates,{day:sourceDay,previous,castQuality:candidate=>castQuality(buildCast(candidate,data.history,data.times,metadata),metadata)}):[];
  let chosen:CaseDraft|null=null;
  for(const candidate of ranked){
   try{const draft=buildCase(candidate.candidate,data.history,data.times,metadata,rules,'0x'+'00'.repeat(32));if(validateCase(draft).length||verifyCaseSources(draft,candidates,data.history,data.times,metadata,rules).length)continue;chosen=draft;break;}catch(error){if(!/^CASE_(OPTIONS|CAST|LIE):/.test((error as Error).message))throw error;}
  }
  const archive=(JSON.parse(await readFile(join(root,'runs/case-engine/fallback.json'),'utf8')) as {cases:CaseDraft[]}).cases;
  const previousPlans:SavedPlan[]=[];
  for(const file of (await readdir(join(directory,'plans'))).filter(file=>/^\d{4}-\d{2}-\d{2}\.json$/.test(file)))previousPlans.push(JSON.parse(await readFile(join(directory,'plans',file),'utf8')));
  const drafts=dailySources(day,archive,previousPlans,chosen).map(item=>({...item,draft:dailyDraft(item.draft,day,item.kind)}));
  for(const item of drafts){
   item.draft.private.facts=buildMemories(item.draft,data.history,data.times,metadata);item.draft=planFullLie(item.draft,metadata);
   for(const member of item.draft.public.cast)for(const card of cards){memoryLine(item.draft,member.tokenId,card);memoryLine(item.draft,member.tokenId,card,true);}
   freezeMemories(item.draft);item.draft=bindCaseContent(item.draft);await vault.save(item.draft);
  }
  // Ledger records and every witness card must match successful canonical RPC receipts.
  const selectedSources=drafts.flatMap(item=>[...item.draft.public.ledger.flatMap(fact=>fact.sources),...Object.values(item.draft.private.facts??{}).flatMap(memory=>Object.values(memory.cards).flatMap(fact=>fact.sources))]);
  for(const tx of new Set(selectedSources.map(source=>source.tx))){
   const receipt=await data.rpc.getTransactionReceipt({hash:tx as `0x${string}`});if(receipt.status!=='success')throw new Error('DAILY_RECEIPT: Selected source transaction failed');
   const canonical=await data.rpc.getBlock({blockNumber:receipt.blockNumber});if(canonical.hash!==receipt.blockHash)throw new Error('DAILY_REORG: Selected receipt is no longer canonical');
   for(const source of selectedSources.filter(source=>source.tx===tx)){
    const original=data.data.logs.find(log=>log.transactionHash===source.tx&&log.logIndex===source.logIndex),actual=receipt.logs.find(log=>log.logIndex===source.logIndex);
    if(Number(receipt.blockNumber)!==source.block||!original||!actual||actual.address.toLowerCase()!==original.address.toLowerCase()||actual.data!==original.data||JSON.stringify(actual.topics)!==JSON.stringify(original.topics.filter(topic=>topic!==null)))throw new Error('DAILY_RECEIPT: Source log does not match receipt');
   }
   await mkdir(join(directory,'receipts'),{recursive:true,mode:0o700});await atomicJSON(join(directory,'receipts',tx+'.json'),JSON.parse(JSON.stringify(receipt,(_,value)=>typeof value==='bigint'?value.toString():value)));
  }
  plan={day,sourceDay,opensAt:Date.parse(day+'T00:20:00Z')/1000,closesAt:Date.parse(day+'T00:20:00Z')/1000+86400,cases:drafts.map(item=>({id:item.draft.public.id,kind:item.kind,source:item.source,sourceCaseId:sourceCaseId(item.draft)})),toBlockExclusive:data.toBlockExclusive,...(recovery.degraded?{condition:'DEGRADED' as const,reason:safeError(new Error(recovery.reason!))}:{})};
  await atomicJSON(join(directory,'plans',day+'.json'),plan);
 }
 const address=process.env.CASEBOOK_ADDRESS;
 if(!address||!isAddress(address)||!process.env.SERVER_PRIVATE_KEY||process.env.EXECUTION_WRITES_ENABLED!=='true'){
  await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:plan.condition??'READY_TO_COMMIT',publicationState:'READY_TO_COMMIT',condition:plan.condition??null,sourceReason:plan.reason??null,day,sourceDay,preparedCases:plan.cases.length,toBlockExclusive:plan.toBlockExclusive,reason:'CaseBook deployment, server signer and explicit write switch are required. No daily case has been published.'});
  console.log(JSON.stringify({status:plan.condition??'READY_TO_COMMIT',publicationState:'READY_TO_COMMIT',day,cases:plan.cases.length,writes:0}));process.exit(0);
 }
 const publisher=activePublisher??new Publisher(join(root,'runs/publications'),vault,await casebookChain(root,address));
 // Finish older reveals before opening new cases. Every step resumes its journal.
 await mkdir(join(root,'runs/publications'),{recursive:true,mode:0o700});
 for(const file of (await readdir(join(root,'runs/publications'))).filter(file=>/^\d{4}-\d{2}-\d{2}-(main|cold)\.json$/.test(file))){
  const record=await publisher.read(file.slice(0,-5));if(record?.open&&record.closesAt<=Date.now()/1000&&record.status!=='COMPLETE')await publisher.close(record.id);
 }
 for(const item of plan.cases){await publisher.prepare(await vault.load(item.id),day,item.source,plan.opensAt,plan.closesAt,item.kind);await publisher.publish(item.id);}
 await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:Date.now()/1000>=plan.opensAt?'PUBLISHED':'COMMITTED_WAITING_OPEN',condition:plan.condition??null,sourceReason:plan.reason??null,day,sourceDay,cases:plan.cases.length,toBlockExclusive:plan.toBlockExclusive});
 console.log(JSON.stringify({status:'DAILY_RUN_COMPLETE',day}));
}catch(error){
 const reason=safeError(error),waiting=error instanceof Error&&error.message.startsWith('DAILY_SOURCE_WAIT:');await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:waiting?'WAITING_SOURCE':'FAILED',day,reason});console.error(reason);process.exitCode=waiting?0:1;
}
