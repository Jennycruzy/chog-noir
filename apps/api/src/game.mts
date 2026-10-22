import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Metadata} from '../../../packages/cases/src/build.mts';
import type {EnrichedEvent} from '../../../packages/core/src/enrich.mts';
import {loadEnv} from '../../../scripts/env.mts';
import {localVault,privateVaultKeyFile} from '../../../packages/publishing/src/vault.mts';
import {PublishedPuzzles} from '../../../packages/publishing/src/puzzles.mts';
import {precinctReport} from '../../../packages/core/src/report.mts';
import {lookupDesk} from '../../../packages/detector/src/desk.mts';
import {verifyPuzzlePublication} from '../../../packages/chain/src/verify.mts';
import {holderServices} from '../../../packages/auth/src/services.mts';
import {HolderPlays} from '../../../packages/game/src/plays.mts';
import {RookieDesk} from '../../../packages/game/src/rookie.mts';
import type {PuzzleSession} from '../../../packages/game/src/puzzle-session.mts';
import {holderRoutes} from './auth.mts';
import {randomBytes} from 'node:crypto';
import {TrainingDesk,type TrainingCase} from '../../../packages/game/src/training.mts';
import {OptOuts} from '../../../packages/auth/src/optout.mts';
import {issueImage,shareImage} from '../../../packages/art/src/render.mts';
import {ChogBurns} from '../../../packages/game/src/burns.mts';
import {HunchDesk} from '../../../packages/game/src/arcs.mts';
import {PushDesk} from '../../../packages/game/src/push.mts';
import {createPublicClient,http} from 'viem';
import {monad} from '../../../packages/chain/src/client.mts';
import {playRoutes,type PlayOptions} from './play.mts';
import {publicContext,type PublicContext} from './context.mts';
import {safeError} from '../../../scripts/errors.mts';
import {feedLine,type FeedEvent} from '../../../packages/indexer/src/feed.mts';

type Route=(request:IncomingMessage,response:ServerResponse)=>Promise<boolean>;
const json=(response:ServerResponse,status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));};

/** Public read-only pages kept from the archive: the Precinct Report, the Scam Desk lookup and the live ticker. */
export function publicRoutes({root,context,names}:{root:string;context:PublicContext|null;names:(tokenId:number)=>string|undefined}):Route&{close():void;history():{history:readonly EnrichedEvent[];times:ReadonlyMap<number,number>}|null}{
 let current=context,sourceRefresh=0,sourceVersion='';const feeds=new Set<ServerResponse>();
 async function refreshHistory(){
  if(!current||Date.now()-sourceRefresh<30_000)return;sourceRefresh=Date.now();
  try{
   const paths=['runs/daily/source/enriched.json','runs/daily/source/history.json'].map(path=>resolve(root,path));
   const version=(await Promise.all(paths.map(path=>stat(path)))).map(stamp=>`${stamp.mtimeMs}:${stamp.size}`).join('/');
   if(version===sourceVersion)return;
   const texts=await Promise.all(paths.map(path=>readFile(path,'utf8'))),rows=JSON.parse(texts[0]!).events as EnrichedEvent[],history=JSON.parse(texts[1]!);
   const times=new Map<number,number>(history.data.blocks.map((block:{number:number;timestamp:number})=>[block.number,block.timestamp]));
   if(!Number.isSafeInteger(history.toBlockExclusive)||!Number.isFinite(history.coverageAt)||!Array.isArray(rows)||rows.some(row=>!times.has(row.event.block)||row.event.block>=history.toBlockExclusive))throw new Error('SOURCE_HISTORY_INVALID');
   current={...current,history:rows,times,toBlockExclusive:history.toBlockExclusive,coverageAt:history.coverageAt};sourceVersion=version;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.error('SOURCE_HISTORY_REFRESH_FAILED',safeError(error));}
 }
 async function live(){
  try{
   const saved=JSON.parse(await readFile(resolve(root,'runs/live/feed.json'),'utf8')) as {updatedAt:string;state:string;note:string;events:FeedEvent[]};
   // Newest first, each as a plain line; events from an older feed format without a price are left out rather than guessed.
   const events=saved.events.filter(row=>row.grossWei&&row.asset).reverse().map(row=>({id:row.id,kind:'SALE',tokenId:row.tokenId,tx:row.tx,time:row.time,text:feedLine(row,names(row.tokenId)??'A Chog')}));
   return {updatedAt:saved.updatedAt,note:saved.note,events,state:Date.now()-Date.parse(saved.updatedAt)>60_000?'STALE':saved.state};
  }catch{return {state:'OFFLINE',events:[],note:'The live source service has not produced a checked feed yet.'};}
 }
 const timer=setInterval(()=>{if(!feeds.size)return;void live().then(snapshot=>{for(const response of feeds)response.write('event: feed\ndata: '+JSON.stringify(snapshot)+'\n\n');}).catch(()=>{});},5000);timer.unref();
 const handler=async(request:IncomingMessage,response:ServerResponse)=>{
  const url=new URL(request.url??'/','http://localhost');
  if(request.method!=='GET'||!['/api/report','/api/scam-desk','/api/live','/api/events'].includes(url.pathname))return false;
  await refreshHistory();
  if(url.pathname==='/api/live'){json(response,200,await live());return true;}
  if(url.pathname==='/api/events'){
   if(feeds.size>=64){json(response,429,{error:'The live feed is busy. Please retry shortly.'});return true;}
   response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no'});response.write('event: feed\ndata: '+JSON.stringify(await live())+'\n\n');feeds.add(response);request.on('close',()=>feeds.delete(response));return true;
  }
  if(url.pathname==='/api/report'){
   if(!current){json(response,503,{error:'The saved history is not available yet.'});return true;}
   const lastDay=Math.floor(current.coverageAt/86400)*86400,day=url.searchParams.get('day')??new Date((lastDay-86400)*1000).toISOString().slice(0,10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Date.parse(day+'T00:00:00Z')/1000>=lastDay){json(response,400,{error:'Choose a complete day in the saved history.'});return true;}
   try{json(response,200,{...precinctReport(day,current.history,current.times),toBlockExclusive:current.toBlockExclusive});}catch{json(response,400,{error:'Choose a valid UTC date.'});}
   return true;
  }
  if(!current?.desk){json(response,503,{error:'The saved proof-backed records are not available yet.'});return true;}
  try{json(response,200,lookupDesk(url.searchParams.get('wallet')??'',current.desk));}catch{json(response,400,{error:'Enter a full Monad wallet address.'});}
  return true;
 };
 // The latest saved history, refreshed by the same reload the report uses.
 return Object.assign(handler,{close(){clearInterval(timer);for(const response of feeds)response.end();feeds.clear();},history:()=>{void refreshHistory();return current?{history:current.history,times:current.times}:null;}});
}

export function gameServer({routes,health}:{routes:(Route&{close?():void})[];health:()=>Promise<Record<string,unknown>>}){
 const server=createServer(async(request,response)=>{
  try{
   const url=new URL(request.url??'/','http://localhost');
   if(request.method==='GET'&&['/health','/api/health'].includes(url.pathname))return json(response,200,{service:'chog-noir',...await health()});
   for(const route of routes)if(await route(request,response))return;
   json(response,404,{code:'ROUTE_NOT_FOUND',error:'That bureau page is unavailable.'});
  }catch(error){
   console.error('GAME_REQUEST_FAILED',safeError(error));
   if(response.headersSent){response.destroy();return;}
   json(response,503,{code:'BUREAU_UNAVAILABLE',error:'The bureau is temporarily unavailable. Your last saved progress is safe. Try again.'});
  }
 });
 server.on('close',()=>{for(const route of routes)route.close?.();});
 server.requestTimeout=15_000;server.headersTimeout=10_000;return server;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await loadEnv();
 const root=fileURLToPath(new URL('../../../',import.meta.url)),origin=process.env.BUREAU_ORIGIN??'https://chognoir.54-154-121-30.sslip.io/';
 const port=Number(process.env.PORT??8311);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('GAME_PORT');
 const services=await holderServices({root,origin});
 const metadata=new Map<number,Metadata>([...services.metadata].map(([id,record])=>[id,record.metadata]));
 const [enriched,history]=await Promise.all(['runs/daily/source/enriched.json','runs/daily/source/history.json'].map(path=>readFile(join(root,path),'utf8').catch(()=>null)));
 const context=enriched&&history?await (async()=>{const rows=(JSON.parse(enriched) as {events:EnrichedEvent[]}).events,saved=JSON.parse(history);const times=new Map<number,number>(saved.data.blocks.map((block:{number:number;timestamp:number})=>[block.number,block.timestamp]));return publicContext(root,rows,times,saved.toBlockExclusive,saved.coverageAt);})():null;
 const cases=new PublishedPuzzles(join(root,'runs/puzzle-publications'),await localVault(join(root,'runs/publication-vault'),privateVaultKeyFile()));
 // Training and replay files are rebuilt offline from real archived records; the API re-reads them when they change.
 const saved=<T,>(path:string)=>{let version='',value:T|null=null;return async()=>{const info=await stat(join(root,path)).catch(()=>null);if(!info)return null;const next=info.mtimeMs+':'+info.size;if(next!==version){value=JSON.parse(await readFile(join(root,path),'utf8')) as T;version=next;}return value;};};
 const trainingFile=saved<TrainingCase>('runs/training/case.json');let training:TrainingCase|null=await trainingFile();
 setInterval(()=>{void trainingFile().then(value=>{training=value;}).catch(()=>{});},60_000).unref();
 const optOuts=new OptOuts(root);
 const options:PlayOptions={origin,...services,cases,plays:new HolderPlays(root),rookies:new RookieDesk<PuzzleSession>({root,metadata,secure:origin.startsWith('https:')}),trustProxy:true,verify:(record,file)=>verifyPuzzlePublication(record,file),
  training:new TrainingDesk(randomBytes(32),()=>training),replay:saved('runs/replay/replay.json'),optOut:address=>optOuts.record(address),
  render:{issue:(puzzle,issue,landscape)=>issueImage(root,puzzle,issue,landscape),share:facts=>shareImage(root,facts)},
  burns:new ChogBurns({root,client:createPublicClient({chain:monad,transport:http(process.env.MONAD_RPC_HTTP??'https://rpc2.monad.xyz',{timeout:20_000,retryCount:1})})})};
 const health=async()=>{
  const status=await readFile(join(root,'runs/daily/status.json'),'utf8').then(text=>JSON.parse(text)).catch(()=>({status:'NOT_STARTED'}));
  const owners=await readFile(join(root,'runs/owners/snapshot.json'),'utf8').then(text=>{const value=JSON.parse(text);return {indexedBlock:value.indexedBlock,ageSeconds:Math.round((Date.now()-value.indexedAt)/1000)};}).catch(()=>null);
  const published=await cases.list(),open=await cases.current(Date.now());
  const alerts=await readFile(join(root,'runs/alerts/status.json'),'utf8').then(text=>{const value=JSON.parse(text);return {checkedAt:value.checkedAt,codes:value.alerts.map((row:{code:string})=>row.code)};}).catch(()=>null);
  return {daily:{status:status.status,day:status.day??null,caseId:status.caseId??null},alerts,caseOpen:!!open,casesPublished:published.length,lastOpenTx:published.at(-1)?.open?.hash??null,owners,history:context?{toBlockExclusive:context.toBlockExclusive,coverageAt:context.coverageAt}:null};
 };
 const pages=publicRoutes({root,context,names:id=>metadata.get(id)?.name});options.history=pages.history;options.hunches=new HunchDesk(root);
 options.push=new PushDesk({root,keyFile:process.env.PUSH_KEY_FILE??'/home/ubuntu/chognoir-private/push-vapid.json',subject:new URL(origin).origin});
 const server=gameServer({routes:[holderRoutes({origin,auth:services.auth,roster:services.roster,trustProxy:true}),playRoutes(options),pages],health});
 server.listen(port,'127.0.0.1',()=>console.log(`Chog Noir listening on 127.0.0.1:${port}`));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();server.closeAllConnections();});
}
