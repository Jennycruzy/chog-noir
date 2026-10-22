import {access,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isAddress,createPublicClient,http,type Address} from 'viem';
import {monad,puzzleChain} from '../../packages/chain/src/client.mts';
import type {StoredHistory} from '../../scripts/data-types.mts';
import type {EnrichedEvent} from '../../packages/core/src/enrich.mts';
import type {Metadata} from '../../packages/cases/src/build.mts';
import type {CaseRules} from '../../packages/cases/src/select.mts';
import type {OwnerSnapshot} from '../../packages/auth/src/holders.mts';
import type {PuzzleCase} from '../../packages/cases/src/puzzle.mts';
import {CareerStore} from '../../packages/career/src/store.mts';
import {OptOuts} from '../../packages/auth/src/optout.mts';
import {WitnessConnections} from '../../packages/auth/src/connections.mts';
import type {MetadataRecord} from '../../packages/auth/src/roster.mts';
import {loadEnv} from '../../scripts/env.mts';
import {collectDaily} from './collect.mts';
import {recoverDailySource} from './plan.mts';
import {buildDailyPuzzle,type CaseEvent} from './build.mts';
import {verifySourceReceipts,puzzleSources} from './receipts.mts';
import {localVault,privateVaultKeyFile,atomicJSON} from '../../packages/publishing/src/vault.mts';
import {PuzzlePublisher} from '../../packages/publishing/src/puzzles.mts';
import {PushDesk} from '../../packages/game/src/push.mts';
import Anthropic from '@anthropic-ai/sdk';
import {WitnessVoice,applyVoice,caseVoiceRequests,personaOf,VoiceError} from '../../packages/witness/src/voice.mts';
import {safeError} from '../../scripts/errors.mts';
await loadEnv();
if(process.env.CHOG_CHAIN_LOCKED!=='true')throw new Error('DAILY_LOCK: Run through corepack pnpm daily:run or the systemd service');
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=join(root,'runs/daily');await mkdir(join(directory,'cases'),{recursive:true,mode:0o700});
const day=new Date().toISOString().slice(0,10);
const vault=await localVault(join(root,'runs/publication-vault'),privateVaultKeyFile());
const statusPath=join(directory,'status.json');
/** The private record of which real event today's case was built from. The case itself is sealed in the vault. */
interface DailyCase {v:2;day:string;id:string;source:'FRESH'|'COLD_FALLBACK';event:CaseEvent;toBlockExclusive:number;builtAt:string;condition:'DEGRADED'|null;reason:string|null;rejected:number;fallbackPool:number;personas:[number,string][];voice:{model:string;batch:string|null;voiced:number;total:number;note:string|null}|null}
const casePath=(date:string)=>join(directory,'cases',date+'.json');
async function savedCase(date:string):Promise<DailyCase|null>{try{return JSON.parse(await readFile(casePath(date),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
try{
 const address=process.env.CASEBOOK_ADDRESS,writable=!!address&&isAddress(address)&&!!process.env.SERVER_PRIVATE_KEY&&process.env.EXECUTION_WRITES_ENABLED==='true';
 const publisher=writable?new PuzzlePublisher(join(root,'runs/puzzle-publications'),vault,await puzzleChain(root,address as Address)):null;
 // Finish yesterday first: reveal the key, record the cast, then every holder's result. Each step resumes its journal.
 if(publisher){
  const career=new CareerStore(root);
  for(const record of await publisher.list())if(record.open&&record.closesAt*1000<=Date.now()&&record.status!=='COMPLETE'){
   await publisher.close(record.day);
   const rows=(await career.results(record.id)).map(({tokenId,result})=>({tokenId,solved:result.solved,perfect:result.perfect,caught:result.lies,grade:result.grade}));
   await publisher.recordSolves(record.day,rows);
  }
 }
 let plan=await savedCase(day);
 if(!plan){
  await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:'BUILDING',day});
  const recovery=await recoverDailySource(()=>collectDaily(root,Math.max(Date.parse(day+'T00:10:00Z'),Date.now()+30_000)),async()=>{
   // Degraded days build from the latest saved, already verified history.
   const sourced=async(historyPath:string,enrichedPath:string)=>{const snapshot=JSON.parse(await readFile(join(root,historyPath),'utf8')) as StoredHistory&{coverageAt?:number},enriched=JSON.parse(await readFile(join(root,enrichedPath),'utf8')) as {events:EnrichedEvent[]};return {snapshot,enriched};};
   const {snapshot,enriched}=await sourced('runs/daily/source/history.json','runs/daily/source/enriched.json').catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return sourced('data/related/history.json','runs/classification/enriched.json');});
   return {history:enriched.events,times:new Map(snapshot.data.blocks.map(block=>[block.number,block.timestamp])),coverageAt:snapshot.coverageAt??Math.max(...snapshot.data.blocks.map(block=>block.timestamp)),rpc:createPublicClient({chain:monad,transport:http(process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz',{timeout:30_000})}),data:snapshot.data,toBlockExclusive:snapshot.toBlockExclusive};
  },day);
  const {data}=recovery;
  if(recovery.degraded)console.error('DAILY_DEGRADED',safeError(new Error(recovery.reason!)));
  const metadata=new Map<number,Metadata>(),records=new Map<number,MetadataRecord>();
  for(let start=1;start<=1969;start+=64)await Promise.all(Array.from({length:Math.min(64,1970-start)},async(_,offset)=>{const id=start+offset,record=JSON.parse(await readFile(join(root,`data/metadata/${id}.json`),'utf8')) as MetadataRecord;records.set(id,record);metadata.set(id,record.metadata);}));
  const rules=JSON.parse(await readFile(join(root,'config/cases.json'),'utf8')) as CaseRules;
  const ownership=JSON.parse(await readFile(join(root,'runs/owners/snapshot.json'),'utf8')) as OwnerSnapshot;
  const bulkIds=new Set(data.history.filter(row=>row.event.class==='BULK_MOVE').map(row=>row.event.tx)),fetchedAt=new Date().toISOString();
  const bulkSources=data.data.transactions.filter(row=>bulkIds.has(row.hash)).map(transaction=>({transaction,logs:data.data.logs.filter(log=>log.transactionHash===transaction.hash),fetchedAt}));
  const previous:CaseEvent[]=[];
  for(const file of (await readdir(join(directory,'cases'))).filter(name=>/^\d{4}-\d{2}-\d{2}\.json$/.test(name)&&name.slice(0,10)<day).sort().slice(-7))previous.push((JSON.parse(await readFile(join(directory,'cases',file),'utf8')) as DailyCase).event);
  // Link coverage: the share of all Chogs that would see a "Knows your Chog" witness in this cast, as of the source day's end.
  const dayEnd=Date.parse(day+'T00:00:00Z')/1000,lastBlock=Math.max(...[...data.times].filter(([,at])=>at<dayEnd).map(([block])=>block),0);
  const links=new WitnessConnections({snapshot:ownership,metadata:records,atBlock:Math.min(lastBlock,ownership.indexedBlock)});
  const linkCoverage=(cast:readonly number[])=>{let linked=0;for(let id=1;id<=1969;id++)if(cast.some(witness=>links.between(id,witness).length))linked++;return linked/1969;};
  const build=buildDailyPuzzle({day,salt:'0x'+randomBytes(32).toString('hex'),previous,optedOut:await new OptOuts(root).wallets(),linkCoverage,history:data.history,times:data.times,metadata,ownership,bulkSources,rules});
  await verifySourceReceipts(data.rpc,data.data,puzzleSources(build.puzzle),join(directory,'receipts'));
  // Seal before any chain write, so a retry commits the same key and salt.
  // Sealed with template lines first; voicing (if enabled) replaces only the words before the lock is sent.
  await vault.seal(build.puzzle.file.id,build.puzzle);
  plan={v:2,day,id:build.puzzle.file.id,source:build.source,event:build.event,toBlockExclusive:data.toBlockExclusive,builtAt:new Date().toISOString(),condition:recovery.degraded?'DEGRADED':null,reason:recovery.degraded?safeError(new Error(recovery.reason!)):null,rejected:build.rejected.length,fallbackPool:build.fallbackPool,
   personas:build.puzzle.file.cast.map(row=>[row.tokenId,personaOf(metadata.get(row.tokenId)!)]),voice:null};
  await atomicJSON(casePath(day),plan);
 }
 // Witness voice: only with a configured model and key, inside the lifetime budget, and finished by 00:15 UTC so the
 // lock is never late. Whatever is not voiced by then keeps its human-written template.
 const voiceModel=process.env.VOICE_MODEL;
 if(voiceModel&&process.env.ANTHROPIC_API_KEY&&!(publisher&&await publisher.read(day))&&!plan.voice?.note){
  const voice=new WitnessVoice({root,client:new Anthropic().messages.batches}),personas=new Map(plan.personas);
  let puzzle=await vault.open<PuzzleCase>(plan.id);const requests=caseVoiceRequests(puzzle,personas).map(row=>row.request);
  plan.voice??={model:voiceModel,batch:null,voiced:0,total:requests.length,note:null};
  try{if(!plan.voice.batch)plan.voice.batch=await voice.submit(voiceModel,requests);await voice.collect();}
  catch(error){if(!(error instanceof VoiceError))throw error;plan.voice.note=error.code;}
  const voiced=await Promise.all(requests.map(request=>voice.voiced(voiceModel,request)));
  if(voiced.every(Boolean)||Date.now()>=Date.parse(day+'T00:15:00Z')||plan.voice.note){
   puzzle=await applyVoice(puzzle,personas,(request,seed)=>voice.line(voiceModel,request,seed));
   await vault.seal(plan.id,puzzle);plan.voice.voiced=voiced.filter(Boolean).length;plan.voice.note??=voiced.every(Boolean)?'VOICED':'DEADLINE_TEMPLATES';
  }
  await atomicJSON(casePath(day),plan);
  if(!plan.voice.note){await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:'VOICING',day,caseId:plan.id});console.log(JSON.stringify({status:'VOICING',day}));process.exit(0);}
 }
 if(!publisher){
  await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:'READY_TO_COMMIT',day,caseId:plan.id,source:plan.source,condition:plan.condition,toBlockExclusive:plan.toBlockExclusive,reason:'CaseBook deployment, the funded server signer and the explicit write switch are required. No daily case has been published.'});
  console.log(JSON.stringify({status:'READY_TO_COMMIT',day,caseId:plan.id,writes:0}));process.exit(0);
 }
 await publisher.prepare(await vault.open<PuzzleCase>(plan.id),plan.source);
 const record=await publisher.publish(day);
 // Alerts go out once per case, after it is published: never before its answer is locked on chain.
 const announced=join(directory,'cases',day+'.announced');
 if(record.status==='PUBLISHED'&&!await access(announced).then(()=>true,()=>false)){
  const puzzle=await vault.open<PuzzleCase>(plan.id),origin=(process.env.BUREAU_ORIGIN??'https://chognoir.54-154-121-30.sslip.io/').replace(/\/$/,'');
  const report=await new PushDesk({root,keyFile:process.env.PUSH_KEY_FILE??'/home/ubuntu/chognoir-private/push-vapid.json',subject:origin}).announce({caseNumber:record.number,title:puzzle.file.title,cast:puzzle.file.cast.map(row=>row.tokenId),url:origin+'/case'});
  await writeFile(announced,JSON.stringify({...report,at:new Date().toISOString()}),{mode:0o600,flag:'wx'});
 }
 await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:record.status==='PUBLISHED'?'PUBLISHED':'COMMITTED_WAITING_OPEN',day,caseId:plan.id,number:record.number,source:plan.source,condition:plan.condition,openTx:record.open?.hash??null,toBlockExclusive:plan.toBlockExclusive});
 console.log(JSON.stringify({status:'DAILY_RUN_COMPLETE',day,caseId:plan.id,publication:record.status}));
}catch(error){
 const reason=safeError(error),waiting=error instanceof Error&&error.message.startsWith('DAILY_SOURCE_WAIT:');await atomicJSON(statusPath,{updatedAt:new Date().toISOString(),status:waiting?'WAITING_SOURCE':'FAILED',day,reason});console.error(reason);process.exitCode=waiting?0:1;
}
