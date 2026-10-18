import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCase,type CaseDraft,type Metadata} from '../../../packages/cases/src/build.mts';
import {GameError,starterPartners,createSession,play,viewSession,type Session,type Partner} from '../../../packages/game/src/session.mts';

export async function loadGame(root:string){
 const archive=JSON.parse(await readFile(resolve(root,'runs/case-engine/archive.json'),'utf8')) as {cases:CaseDraft[]};
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
 return {cases:archive.cases,partners:starterPartners(metadata)};
}
export function gameServer({root,cases,partners,secure=true}:{root:string;cases:CaseDraft[];partners:Partner[];secure?:boolean}){
 const directory=resolve(root,'runs/game-sessions');
 const byId=new Map(cases.map(draft=>[draft.public.id,draft]));
 const locks=new Map<string,Promise<void>>(),rates=new Map<string,{count:number;until:number}>();
 const cookieName=secure?'__Host-chog_session':'chog_session';
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
  await previous;try{return await fn();}finally{release();if(locks.get(id)===current)locks.delete(id);}
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
   if(request.method==='GET'&&['/health','/api/health'].includes(url.pathname)){
    return json(response,200,{service:'chog-noir',gameAvailable:true,mode:'archive_preview',cases:cases.length,testimony:'templates',onchain:false,indexer:'stopped_after_reliability_check'});
   }
   if(request.method==='GET'&&url.pathname==='/api/cases')return json(response,200,{
    mode:'archive_preview',partners,cases:cases.map((draft,index)=>({id:draft.public.id,number:index+1,type:draft.public.type,occurredAt:draft.public.occurredAt,subject:draft.public.subject,witnesses:draft.public.cast.length})),
   });
   if(request.method==='GET'&&url.pathname==='/api/session'){
    const session=await saved(sessionId(request));return json(response,200,viewSession(draftFor(session),session));
   }
   if(request.method!=='POST'||!['/api/session','/api/session/action'].includes(url.pathname))throw new GameError(404,'Not found.');
   // No cross-origin writes, including form submissions. Nginx supplies the public Host.
   if(request.headers['sec-fetch-site']==='cross-site')throw new GameError(403,'Open the game on its own site.');
   if(request.headers.origin){
    let origin:URL;try{origin=new URL(request.headers.origin);}catch{throw new GameError(403,'Invalid origin.');}
    if(origin.host!==request.headers.host)throw new GameError(403,'Open the game on its own site.');
   }
   const input=await body(request);
   if(url.pathname==='/api/session'){
    const ip=request.socket.remoteAddress==='127.0.0.1'?(request.headers['x-real-ip'] as string??'local'):request.socket.remoteAddress??'unknown';
    const now=Date.now();for(const [key,value] of rates)if(value.until<now)rates.delete(key);
    const rate=rates.get(ip)??{count:0,until:now+60_000};
    if(rate.count>=20||rates.size>=10_000)throw new GameError(429,'Too many new cases. Please try again in a minute.');
    rate.count++;rates.set(ip,rate);
    const draft=byId.get(String(input.caseId)),partner=partners.find(item=>item.tokenId===input.partnerId);
    if(!draft||!partner)throw new GameError(400,'Choose an available case and partner.');
    const id=randomBytes(32).toString('hex'),session=createSession(draft,partner);await save(id,session);
    response.setHeader('set-cookie',`${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure?'; Secure':''}`);
    return json(response,201,viewSession(draft,session));
   }
   const id=sessionId(request);if(!id)throw new GameError(404,'Choose a case to begin.');
   await serial(id,async()=>{
    const session=await saved(id),draft=draftFor(session);
    try{const next=play(draft,session,input);await save(id,next);json(response,200,viewSession(draft,next));}
    catch(error){if(error instanceof GameError&&error.status===409)return json(response,409,{error:error.message,state:viewSession(draft,session)});throw error;}
   });
  }catch(error){
   if(error instanceof GameError)json(response,error.status,{error:error.message});
   else{console.error('GAME_REQUEST_FAILED',error instanceof Error?error.message:'Unknown error');json(response,503,{error:'The case desk is temporarily unavailable. Your last saved progress is safe. Try again.'});}
  }
 });
 server.requestTimeout=15_000;server.headersTimeout=10_000;return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const port=Number(process.env.PORT??8311);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('GAME_PORT');
 const data=await loadGame(root);const server=gameServer({root,...data});
 server.listen(port,'127.0.0.1',()=>console.log(`Chog Noir archive preview listening on 127.0.0.1:${port}`));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close());
}
