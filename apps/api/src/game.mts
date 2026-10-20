import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,mkdir,writeFile,rename,unlink,stat} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCase,type CaseDraft,type Metadata} from '../../../packages/cases/src/build.mts';
import {GameError,starterPartners,createSession,play,viewSession,type Session,type Partner} from '../../../packages/game/src/session.mts';
import {buildMemories,memoryLine} from '../../../packages/witness/src/facts.mts';
import {cards} from '../../../packages/witness/src/lines.mts';
import type {EnrichedEvent} from '../../../packages/core/src/enrich.mts';
import {traitsFor} from '../../../packages/traits/src/traits.mts';
import {withPlayerLock} from '../../../packages/game/src/player-lock.mts';
import {createPlayer,recordResult,recordPending,playerSummary,type Player} from '../../../packages/game/src/progress.mts';
import {loadEnv} from '../../../scripts/env.mts';
import {atomicJSON,privateVaultKeyFile} from '../../../packages/publishing/src/vault.mts';
import {precinctReport} from '../../../packages/core/src/report.mts';
import {lookupDesk} from '../../../packages/detector/src/desk.mts';
import {publicContext,type PublicContext} from './context.mts';
import {publishedCases} from './publications.mts';
import {verifyPublication} from '../../../packages/chain/src/verify.mts';
import type {Publication} from '../../../packages/publishing/src/publish.mts';
import {comic,shareCard} from '../../../packages/art/src/render.mts';
import {safeError} from '../../../scripts/errors.mts';

export async function loadGame(root:string){
 const archiveText=await readFile(resolve(root,'release-archive.json'),'utf8').catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return readFile(resolve(root,'runs/case-engine/archive.json'),'utf8');});
 const archive=JSON.parse(archiveText) as {cases:CaseDraft[]};
 if(!Array.isArray(archive.cases)||!archive.cases.length||archive.cases.some(draft=>validateCase(draft).length))throw new Error('GAME_ARCHIVE: Invalid case archive');
 const metadata=new Map<number,Metadata>();
 // Bound startup I/O, rather than serializing nearly two thousand file reads.
 for(let start=1;start<=1969;start+=64){
  await Promise.all(Array.from({length:Math.min(64,1970-start)},async(_,offset)=>{
   const id=start+offset;
   const saved=JSON.parse(await readFile(resolve(root,`data/metadata/${id}.json`),'utf8'));
   metadata.set(id,saved.metadata);
  }));
 }
 let enriched:string,history:string;
 try{const fresh=await Promise.all(['runs/daily/source/enriched.json','runs/daily/source/history.json'].map(path=>readFile(resolve(root,path),'utf8')));enriched=fresh[0]!;history=fresh[1]!;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const saved=await Promise.all(['runs/classification/enriched.json','data/related/history.json'].map(path=>readFile(resolve(root,path),'utf8')));enriched=saved[0]!;history=saved[1]!;}
 const rows=(JSON.parse(enriched!) as {events:EnrichedEvent[]}).events;
 const blocks=(JSON.parse(history!) as {data:{blocks:{number:number;timestamp:number}[]}}).data.blocks;
 const times=new Map(blocks.map(block=>[block.number,block.timestamp]));
 for(const draft of archive.cases){
  draft.private.facts??=buildMemories(draft,rows,times,metadata);
  for(const witness of draft.public.cast)for(const card of cards){memoryLine(draft,witness.tokenId,card);memoryLine(draft,witness.tokenId,card,true);}
 }
 return {cases:archive.cases,partners:starterPartners(metadata),allPartners:[...metadata].map(([id,item])=>traitsFor(id,item)),context:await publicContext(root,metadata,rows,times,JSON.parse(history!).toBlockExclusive,JSON.parse(history!).coverageAt??Math.max(...times.values()))};
}
export function gameServer({root,cases,partners,allPartners,context,assetsRoot=root,secure=true,vaultKeyPath}:{root:string;cases:CaseDraft[];partners:Partner[];allPartners?:Partner[];context?:PublicContext;assetsRoot?:string;secure?:boolean;vaultKeyPath?:string}){
 const directory=resolve(root,'runs/game-sessions');
 const byId=new Map(cases.map(draft=>[draft.public.id,draft]));
 let publicationRecords:Publication[]=[],publicationRefresh=0,sourceRefresh=0,sourceVersion='';
 let publicationErrors:{caseId:string;code:string}[]=[];const publicationIds=new Set<string>();
 const eventsClients=new Set<ServerResponse>();
 async function refreshPublications(){
  if(Date.now()-publicationRefresh<30_000)return;publicationRefresh=Date.now();
  try{
   const loaded=await publishedCases(root,vaultKeyPath);publicationRecords=loaded.records;publicationErrors=loaded.errors;
   for(const id of publicationIds)byId.delete(id);publicationIds.clear();
   for(const draft of loaded.drafts){byId.set(draft.public.id,draft);publicationIds.add(draft.public.id);}
   for(const error of publicationErrors)console.error(error.code,error.caseId);
  }finally{publicationRefresh=Date.now();}
 }
 async function refreshHistory(){
  const current=context;if(!current||Date.now()-sourceRefresh<30_000)return;sourceRefresh=Date.now();
  try{
   const paths=['runs/daily/source/enriched.json','runs/daily/source/history.json'].map(path=>resolve(root,path));
   const stamps=await Promise.all(paths.map(path=>stat(path))),version=stamps.map(stamp=>`${stamp.mtimeMs}:${stamp.size}`).join('/');
   if(version===sourceVersion)return;
   const texts=await Promise.all(paths.map(path=>readFile(path,'utf8'))),rows=JSON.parse(texts[0]!).events as EnrichedEvent[],history=JSON.parse(texts[1]!);
   const times=new Map<number,number>(history.data.blocks.map((block:{number:number;timestamp:number})=>[block.number,block.timestamp]));
   if(!Number.isSafeInteger(history.toBlockExclusive)||!Number.isFinite(history.coverageAt)||!Array.isArray(rows)||rows.some(row=>!times.has(row.event.block)||row.event.block>=history.toBlockExclusive))throw new Error('SOURCE_HISTORY_INVALID');
   context={...current,history:rows,times,toBlockExclusive:history.toBlockExclusive,coverageAt:history.coverageAt};sourceVersion=version;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.error('SOURCE_HISTORY_REFRESH_FAILED',safeError(error));}
 }
 async function liveSnapshot(){try{const saved=JSON.parse(await readFile(resolve(root,'runs/live/feed.json'),'utf8'));return {...saved,state:Date.now()-Date.parse(saved.updatedAt)>60_000?'STALE':saved.state};}catch{return {state:'OFFLINE',events:[],note:'The live source service has not produced a checked feed yet.'};}}
 const locks=new Map<string,Promise<void>>(),rates=new Map<string,{count:number;until:number}>();
 const guestIds=new WeakMap<IncomingMessage,string>();
 const cookieName=secure?'__Host-chog_session':'chog_session';
 const playerCookie=secure?'__Host-chog_player':'chog_player';
 const pool=allPartners??partners;
 const gameMode=()=>[...byId.values()].some(draft=>draft.public.publication?.kind==='MAIN'&&!draft.public.publication.closed&&draft.public.publication.closesAt>Date.now()/1000)?'daily_cases':'archive_preview';
 const cookieValue=(request:IncomingMessage,name:string)=>{const value=(request.headers.cookie??'').split(';').map(item=>item.trim()).find(item=>item.startsWith(name+'='))?.slice(name.length+1);return value&&/^[a-f0-9]{64}$/.test(value)?value:null;};
 const setCookie=(response:ServerResponse,value:string)=>{const existing=response.getHeader('set-cookie');response.setHeader('set-cookie',[...(Array.isArray(existing)?existing:existing?[String(existing)]:[]),value]);};
 const cookie=(name:string,value:string)=>`${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure?'; Secure':''}`;
 async function guest(request:IncomingMessage,response:ServerResponse){
  if(!allPartners)return null;
  const directory=resolve(root,'runs/players'),persist=request.method==='POST';
  const prior=cookieValue(request,playerCookie),assigned=guestIds.get(request),id=prior??assigned??randomBytes(32).toString('hex'),path=resolve(directory,id+'.json');guestIds.set(request,id);
  let player:Player,persisted=true;
  try{player=JSON.parse(await readFile(path,'utf8'));}catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   player=createPlayer(id,pool);persisted=false;
   if(persist)await serial('player-'+id,async()=>{
    await mkdir(directory,{recursive:true,mode:0o700});
    try{player=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await atomicJSON(path,player);}
    persisted=true;
   });
  }
  if(!prior&&!assigned)setCookie(response,cookie(playerCookie,id));
  return {id,path,player,persisted};
 }
 async function reconcile(request:IncomingMessage,response:ServerResponse,session:Session){
  if(!session.submitted||!allPartners)return;
  const profile=await guest(request,response);if(!profile?.persisted)return;
  await serial('player-'+profile.id,async()=>{
   const current=await readFile(profile.path,'utf8').then(text=>JSON.parse(text) as Player).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return profile.player;});
   const draft=draftFor(session),result=viewSession(draft,session).result!;
   const publication=draft.public.publication;
   const updated=result?recordResult(current,draft,session,result,session.practice?'ARCHIVE':publication?.kind??'ARCHIVE',session.practice?null:publication?.day??null):recordPending(current,draft,new Date(),sessionId(request)??undefined);
   await atomicJSON(profile.path,updated);
  });
 }
 async function finalizePending(request:IncomingMessage,response:ServerResponse,profile:Awaited<ReturnType<typeof guest>>){
  if(!profile?.persisted)return profile;
  for(const pending of profile.player.pending??[]){const id=pending.sessionId??profile.player.sessions[pending.caseId];if(id&&byId.get(pending.caseId)?.public.publication?.closed){const session=await saved(id);if(session.caseId!==pending.caseId)throw new Error('PLAYER_PENDING_SESSION');await reconcile(request,response,session);}}
  return guest(request,response);
 }
 const sessionId=(request:IncomingMessage)=>{
  const token=(request.headers.cookie??'').split(';').map(item=>item.trim()).find(item=>item.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
 };
 async function save(id:string,session:Session){
  await mkdir(directory,{recursive:true,mode:0o700});
  const temporary=resolve(directory,`${id}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(temporary,JSON.stringify(session),{mode:0o600});
  await rename(temporary,resolve(directory,`${id}.json`));
 }
 async function serial<T>(id:string,fn:()=>Promise<T>):Promise<T>{
  const previous=locks.get(id)??Promise.resolve();let release!:()=>void;
  const current=new Promise<void>(done=>{release=done;});locks.set(id,current);
  await previous;try{return id.startsWith('player-')?await withPlayerLock(root,id.slice(7),fn):await fn();}finally{release();if(locks.get(id)===current)locks.delete(id);}
 }
 async function saved(id:string|null){
  if(!id)throw new GameError(404,'No active case. Choose a case to begin.');
  try{return JSON.parse(await readFile(resolve(directory,`${id}.json`),'utf8')) as Session;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new GameError(404,'Your saved case is unavailable. Choose a case to begin.');throw error;}
 }
 const draftFor=(session:Session)=>{const draft=byId.get(session.caseId);if(!draft)throw new GameError(410,'This archived case is unavailable.');return draft;};
 const json=(response:ServerResponse,status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
 async function body(request:IncomingMessage){
  if(!request.headers['content-type']?.startsWith('application/json'))throw new GameError(415,'Send JSON.');
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of request){length+=chunk.length;if(length>8192)throw new GameError(413,'Request is too large.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}
  catch{throw new GameError(400,'Invalid JSON request.');}
 }
 const server=createServer(async(request,response)=>{
  response.setHeader('cache-control','no-store');response.setHeader('x-content-type-options','nosniff');
  try{
   const url=new URL(request.url??'/','http://localhost');
   await refreshHistory();
   if(['/health','/api/health'].includes(url.pathname)||url.pathname==='/api/cases'||url.pathname==='/api/player'||url.pathname.startsWith('/api/publications')||url.pathname.startsWith('/api/session')||url.pathname.startsWith('/api/verify/'))await refreshPublications();
   if(request.method==='GET'&&['/health','/api/health'].includes(url.pathname)){
    return json(response,200,{service:'chog-noir',gameAvailable:true,mode:gameMode(),cases:byId.size,publicationErrors,history:context?{toBlockExclusive:context.toBlockExclusive,coverageAt:context.coverageAt}:null,testimony:'templates',onchain:publicationRecords.some(record=>!!record.open),indexer:(await liveSnapshot()).state,daily:await readFile(resolve(root,'runs/daily/status.json'),'utf8').then(text=>JSON.parse(text)).catch(()=>({status:'NOT_STARTED'}))});
   }
   if(request.method==='GET'&&url.pathname==='/api/cases')return json(response,200,{
    mode:gameMode(),partners:(await guest(request,response))?.player.starters.map(id=>pool.find(item=>item.tokenId===id)!)??partners,cases:[...byId.values()].map((draft,index)=>({id:draft.public.id,number:index+1,type:draft.public.type,occurredAt:draft.public.occurredAt,subject:draft.public.subject,witnesses:draft.public.cast.length,publication:draft.public.publication??null})),
   });
   if(request.method==='GET'&&['/api/session/comic','/api/session/share'].includes(url.pathname)){
    const session=await saved(sessionId(request));if(!session.submitted)throw new GameError(403,'Close the case before revealing its comic or share card.');
    const draft=draftFor(session),result=viewSession(draft,session).result;
    if(!result)throw new GameError(403,'Answers stay locked until the confirmed daily close.');
    const format=url.searchParams.get('format')==='landscape'?'landscape':'portrait',cache=resolve(root,'runs/rendered');await mkdir(cache,{recursive:true,mode:0o700});
    const file=resolve(cache,createHash('sha256').update(`${sessionId(request)}:${url.pathname}:${format}:v1`).digest('hex')+'.png');
    const bytes=await serial('render-'+file,async()=>{try{return await readFile(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}const rendered=url.pathname.endsWith('/comic')?await comic(assetsRoot,draft,format==='landscape'):await shareCard(assetsRoot,draft,result,session.plays,session.initialPlays,session.caught);await writeFile(file,rendered,{mode:0o600});return rendered;});
    response.writeHead(200,{'content-type':'image/png','content-disposition':`${url.searchParams.get('inline')==='1'?'inline':'attachment'}; filename="chog-noir-${url.pathname.endsWith('/comic')?'comic':'result'}.png"`});response.end(bytes);return;
   }
   if(request.method==='GET'&&url.pathname==='/api/session'){
    const session=await saved(sessionId(request));await reconcile(request,response,session);return json(response,200,viewSession(draftFor(session),session));
   }
   if(request.method==='GET'&&url.pathname==='/api/publications')return json(response,200,{cases:publicationRecords.filter(item=>!!item.open).map(item=>({id:item.id,status:item.status,day:item.day,opensAt:item.opensAt,closesAt:item.closesAt,contract:item.contract,openTx:item.open!.hash,closeTx:item.close?.hash??null}))});
   if(request.method==='GET'&&/^\/api\/publications\/\d{4}-\d{2}-\d{2}-(main|cold)\/bundle$/.test(url.pathname)){
    const id=url.pathname.split('/')[3]!,record=publicationRecords.find(item=>item.id===id),draft=byId.get(id);
    if(!record||!draft)throw new GameError(404,'Published case not found.');
    if(!record.close)throw new GameError(403,'The full verification bundle becomes public after a confirmed case close.');
    return json(response,200,{v:1,publication:record,case:draft.public,facts:draft.private.facts??null,key:draft.private.key,salt:draft.private.salt});
   }
   if(request.method==='GET'&&url.pathname.startsWith('/api/verify/')){
    const id=decodeURIComponent(url.pathname.slice('/api/verify/'.length));if(!/^[a-z0-9_-]{1,100}$/.test(id))throw new GameError(400,'Invalid case identifier.');
    const record=publicationRecords.find(item=>item.id===id),draft=byId.get(id);
    if(!record||!draft)return json(response,200,{status:draft?'LOCAL_ONLY':'NOT_FOUND',message:draft?'Archive practice has a saved local commitment, with no on-chain publication claim.':'No published case has this identifier.'});
    try{return json(response,200,await verifyPublication(record,draft));}catch{return json(response,503,{status:'UNVERIFIED',message:'Chain verification could not complete. No pass is claimed. Try again.'});}
   }
   if(request.method==='GET'&&url.pathname==='/api/live')return json(response,200,await liveSnapshot());
   if(request.method==='GET'&&url.pathname==='/api/events'){
    if(eventsClients.size>=64)throw new GameError(429,'The live feed is busy. Please retry shortly.');
    response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no'});response.write('event: feed\ndata: '+JSON.stringify(await liveSnapshot())+'\n\n');eventsClients.add(response);request.on('close',()=>eventsClients.delete(response));return;
   }
   if(request.method==='GET'&&url.pathname==='/api/player'){
    let profile=await guest(request,response);if(!profile)throw new GameError(404,'Player storage is unavailable.');
    profile=await finalizePending(request,response,profile);
    return json(response,200,playerSummary(profile!.player,pool));
   }
   if(request.method==='GET'&&url.pathname==='/api/partners'){
    const profile=await guest(request,response),offset=Math.max(0,Math.min(1969,Number(url.searchParams.get('offset'))||0)),limit=Math.max(1,Math.min(100,Number(url.searchParams.get('limit'))||48));
    const group=url.searchParams.get('group'),query=(url.searchParams.get('q')??'').slice(0,80).toLowerCase();
    const items=pool.filter(item=>(!group||item.power===group)&&(!query||item.name.toLowerCase().includes(query)));
    return json(response,200,{total:items.length,offset,items:items.slice(offset,offset+limit).map(item=>({...item,unlocked:!!profile?.player.unlocked.includes(item.tokenId)}))});
   }
   if(request.method==='GET'&&/^\/api\/chog\/\d+$/.test(url.pathname)&&context){
    const current=context,id=Number(url.pathname.split('/').at(-1)),profile=current.profiles.get(id);if(!profile)throw new GameError(404,'Chog not found.');
    const moves=current.history.filter(row=>row.event.tokenId===id).map(row=>({class:row.event.class,from:row.event.from,to:row.event.to,time:new Date(current.times.get(row.event.block)!*1000).toISOString(),source:{tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex},price:row.event.price??null}));
    return json(response,200,{...profile,toBlockExclusive:context.toBlockExclusive,moves,cases:[...byId.values()].filter(draft=>draft.public.cast.some(member=>member.tokenId===id)).map(draft=>({id:draft.public.id,type:draft.public.type,subject:draft.public.subject.name,occurredAt:draft.public.occurredAt})),onchainRecords:publicationRecords.filter(record=>!!record.cast&&byId.get(record.id)?.public.cast.some(member=>member.tokenId===id)).map(record=>({caseId:record.id,tx:record.cast!.hash,closedAt:record.close!.timestamp}))});
   }
   if(request.method==='GET'&&url.pathname==='/api/report'&&context){
    const last=context.coverageAt,lastDay=Math.floor(last/86400)*86400;
    const day=url.searchParams.get('day')??new Date((lastDay-86400)*1000).toISOString().slice(0,10);
    if(Date.parse(day+'T00:00:00Z')/1000>=lastDay)throw new GameError(400,'Choose a complete day in the saved history.');
    try{return json(response,200,{...precinctReport(day,context.history,context.times),toBlockExclusive:context.toBlockExclusive});}catch{throw new GameError(400,'Choose a valid UTC date.');}
   }
   if(request.method==='GET'&&url.pathname==='/api/scam-desk'){
    if(!context?.desk)throw new GameError(503,'The saved proof-backed records is not available yet.');
    try{return json(response,200,lookupDesk(url.searchParams.get('wallet')??'',context.desk));}catch{throw new GameError(400,'Enter a full Monad wallet address.');}
   }
   if(request.method!=='POST'||!['/api/session','/api/session/action','/api/player/delete'].includes(url.pathname))throw new GameError(404,'Not found.');
   // No cross-origin writes, including form submissions. Nginx supplies the public Host.
   if(request.headers['sec-fetch-site']==='cross-site')throw new GameError(403,'Open the game on its own site.');
   if(request.headers.origin){
    let origin:URL;try{origin=new URL(request.headers.origin);}catch{throw new GameError(403,'Invalid origin.');}
    if(origin.host!==request.headers.host)throw new GameError(403,'Open the game on its own site.');
   }
   const input=await body(request);
   if(url.pathname==='/api/player/delete'){
    if(input.confirm!=='DELETE')throw new GameError(400,'Confirm deletion.');const profile=await guest(request,response);if(profile){
     await serial('player-'+profile.id,async()=>{const current=await readFile(profile.path,'utf8').then(text=>JSON.parse(text) as Player).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return profile.player;});for(const id of new Set([...Object.values(current.sessions),...(current.sessionIds??[])]))if(/^[a-f0-9]{64}$/.test(id))await unlink(resolve(directory,id+'.json')).catch(()=>{});await unlink(profile.path).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});});
    }
    setCookie(response,`${playerCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure?'; Secure':''}`);setCookie(response,`${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure?'; Secure':''}`);return json(response,200,{deleted:true});
   }
   if(url.pathname==='/api/session'){
    const ip=request.socket.remoteAddress==='127.0.0.1'?(request.headers['x-real-ip'] as string??'local'):request.socket.remoteAddress??'unknown';
    const now=Date.now();for(const [key,value] of rates)if(value.until<now)rates.delete(key);
    const rate=rates.get(ip)??{count:0,until:now+60_000};
    if(rate.count>=20||rates.size>=10_000)throw new GameError(429,'Too many new cases. Please try again in a minute.');
    rate.count++;rates.set(ip,rate);
    const profile=await finalizePending(request,response,await guest(request,response));
    const allowed=profile?pool.filter(item=>profile.player.unlocked.includes(item.tokenId)||(!cookieValue(request,playerCookie)&&partners.some(starter=>starter.tokenId===item.tokenId))):partners;
    const draft=byId.get(String(input.caseId)),partner=allowed.find(item=>item.tokenId===input.partnerId);
    if(!draft||!partner)throw new GameError(400,'Choose an available case and partner.');
    if(draft.public.publication&&!draft.public.publication.closed&&draft.public.publication.closesAt<=Date.now()/1000)throw new GameError(403,'Daily play has closed. Wait for the confirmed reveal.');
    if(input.restart===true&&draft.public.publication&&!draft.public.publication.closed&&((profile&&profile.player.sessions[draft.public.id])||(await saved(sessionId(request)).catch(()=>null))?.caseId===draft.public.id))throw new GameError(403,'This daily case cannot be restarted before its confirmed close.');
    if(profile&&profile.player.sessions[draft.public.id]&&input.restart!==true){const existingId=profile.player.sessions[draft.public.id]!,existing=await saved(existingId);setCookie(response,cookie(cookieName,existingId));return json(response,200,viewSession(draft,existing));}
    const id=randomBytes(32).toString('hex'),session=createSession(draft,partner);await save(id,session);
    if(profile)await serial('player-'+profile.id,async()=>{const current=await readFile(profile.path,'utf8').then(text=>JSON.parse(text) as Player).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return profile.player;});current.sessions[draft.public.id]=id;current.sessionIds??=[];current.sessionIds.push(id);await atomicJSON(profile.path,current);});
    setCookie(response,cookie(cookieName,id));
    return json(response,201,viewSession(draft,session));
   }
   const id=sessionId(request);if(!id)throw new GameError(404,'Choose a case to begin.');
   await serial(id,async()=>{
    const session=await saved(id),draft=draftFor(session);
    try{const next=play(draft,session,input);await save(id,next);await reconcile(request,response,next);json(response,200,viewSession(draft,next));}
    catch(error){if(error instanceof GameError&&error.status===409)return json(response,409,{error:error.message,state:viewSession(draft,session)});throw error;}
   });
  }catch(error){
   if(error instanceof GameError)json(response,error.status,{error:error.message});
   else{console.error('GAME_REQUEST_FAILED',safeError(error));json(response,503,{error:'The case desk is temporarily unavailable. Your last saved progress is safe. Try again.'});}
  }
 });
 const feedTimer=setInterval(()=>{void liveSnapshot().then(snapshot=>{for(const response of eventsClients)response.write('event: feed\ndata: '+JSON.stringify(snapshot)+'\n\n');}).catch(()=>{});},5000);feedTimer.unref();server.on('close',()=>{clearInterval(feedTimer);for(const response of eventsClients)response.end();});
 server.requestTimeout=15_000;server.headersTimeout=10_000;return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const port=Number(process.env.PORT??8311);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('GAME_PORT');
 await loadEnv();
 const data=await loadGame(root);const server=gameServer({root,...data,vaultKeyPath:privateVaultKeyFile()});
 server.listen(port,'127.0.0.1',()=>console.log(`Chog Noir listening on 127.0.0.1:${port}`));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();server.closeAllConnections();});
}
