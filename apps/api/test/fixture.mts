import {readFileSync} from 'node:fs';
import {readFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {IncomingMessage,ServerResponse} from 'node:http';
import config from '../../../config/cases.json' with {type:'json'};
import type {EnrichedEvent} from '../../../packages/core/src/enrich.mts';
import type {Metadata} from '../../../packages/cases/src/build.mts';
import {saleCandidates} from '../../../packages/cases/src/select.mts';
import {buildSalePuzzle,type PuzzleCase} from '../../../packages/cases/src/puzzle.mts';
import {WalletAuth} from '../../../packages/auth/src/auth.mts';
import {HolderDirectory,ownerDirectory,type OwnerSnapshot} from '../../../packages/auth/src/holders.mts';
import {DetectiveRoster,type MetadataRecord} from '../../../packages/auth/src/roster.mts';
import {WitnessConnections} from '../../../packages/auth/src/connections.mts';
import {CareerStore} from '../../../packages/career/src/store.mts';
import {HolderPlays} from '../../../packages/game/src/plays.mts';
import {RookieDesk} from '../../../packages/game/src/rookie.mts';
import {TrainingDesk,trainingFromPuzzle} from '../../../packages/game/src/training.mts';
import type {PuzzleSession} from '../../../packages/game/src/puzzle-session.mts';
import type {PuzzlePublication} from '../../../packages/publishing/src/puzzles.mts';
import {buildDailyPuzzle} from '../../../workers/daily/build.mts';
import {holderRoutes} from '../src/auth.mts';
import {playRoutes,type CaseSource} from '../src/play.mts';
import {gameServer} from '../src/game.mts';
import {issueImage,shareImage} from '../../../packages/art/src/render.mts';
import {HunchDesk} from '../../../packages/game/src/arcs.mts';

// Real data only: the owner index of 20 Oct 12:44 UTC, all 1,969 metadata records, and cases built from stored chain records.
const repository=fileURLToPath(new URL('../../../',import.meta.url));
export const snapshot=JSON.parse(readFileSync(join(repository,'packages/auth/test/fixtures/owners.json'),'utf8')).snapshot as OwnerSnapshot;
const rows=JSON.parse(readFileSync(join(repository,'packages/traits/test/fixtures/detectives.json'),'utf8')).tokens as {tokenId:number;metadata:Metadata;source:{uri:string;fetchedAt:string}}[];
export const records=new Map<number,MetadataRecord>(rows.map(row=>[row.tokenId,{metadata:row.metadata,uri:row.source.uri,fetchedAt:row.source.fetchedAt}]));
export const metadata=new Map(rows.map(row=>[row.tokenId,row.metadata]));
const window=JSON.parse(readFileSync(join(repository,'packages/cases/test/fixtures/witness-window.json'),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
/** CHOG token 1021's real moves: the ongoing story on the fixture's day. */
const trail=JSON.parse(readFileSync(join(repository,'packages/cases/test/fixtures/chog-trail.json'),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
/** Tuesday 20 Oct: a real cold case from stored records, open at the time of the owner snapshot. */
export const puzzle:PuzzleCase=buildDailyPuzzle({day:'2026-10-20',salt:'0x'+'c3'.repeat(32),previous:[],history:window.rows,times:new Map(window.times),metadata,ownership:snapshot,bulkSources:[],rules:config}).puzzle;
const replayCandidate=saleCandidates(window.rows,new Map(window.times),config).find(row=>row.row.event.tokenId===1931)!;
export const training=trainingFromPuzzle(buildSalePuzzle({candidate:replayCandidate,history:window.rows,times:new Map(window.times),metadata,day:'2026-10-05',salt:'0x'+'d4'.repeat(32),mode:'REPLAY'}));
export const owners=ownerDirectory(snapshot);
export const holder=owners.get(11)!.owner;
export const record:PuzzlePublication={v:2,id:puzzle.file.id,day:puzzle.file.day,source:'COLD_FALLBACK',number:1,opensAt:puzzle.file.opensAt,closesAt:puzzle.file.closesAt,answerHash:puzzle.answerHash,status:'PUBLISHED',contract:'0x'+'11'.repeat(20),chainId:143,preparedAt:'2026-10-20T00:01:00.000Z',publishedAt:'2026-10-20T00:20:00.000Z',open:{hash:('0x'+'aa'.repeat(32)) as `0x${string}`,blockNumber:'1',blockHash:('0x'+'bb'.repeat(32)) as `0x${string}`,timestamp:puzzle.file.opensAt-600,status:'success',chainId:143,address:('0x'+'11'.repeat(20)) as `0x${string}`},close:null,cast:null,solves:null,solveCount:null};

/**
 * The game API on real data, with a signed test session: the injected verifier accepts the signature the way a contract
 * wallet's check would. `web` also serves the static site so a browser can play it end to end.
 */
export async function fixtureServer(root:string,options:{web?:boolean}={}){
 // The renderer draws real Chog art. The portraits this case uses are committed beside the tests, since data/ is not.
 await mkdir(join(root,'data/images'),{recursive:true});
 for(const file of await readdir(join(repository,'apps/api/test/fixtures/art')))await copyFile(join(repository,'apps/api/test/fixtures/art',file),join(root,'data/images',file));
 let now=snapshot.indexedAt+5000,published={...record};const moved=new Map<number,string>();
 const holders=new HolderDirectory({snapshot:async()=>snapshot,now:()=>now,ownerOf:async id=>moved.get(id)??owners.get(id)!.owner});
 const career=new CareerStore(root),cases:CaseSource={list:async()=>[published],current:async time=>published.opensAt*1000<=time&&time<published.closesAt*1000?{record:published,puzzle}:null,byId:async id=>id===published.id?{record:published,puzzle}:null};
 let origin='';const routes:((request:IncomingMessage,response:ServerResponse)=>Promise<boolean>)[]=[];
 const web=async(request:IncomingMessage,response:ServerResponse)=>{
  if(!options.web)return false;
  const path=new URL(request.url??'/','http://localhost').pathname;
  if(path.startsWith('/api/'))return false;
  const font=path.match(/^\/((?:fonts|img)\/[a-z0-9-]+\.(?:woff2|css|png))$/),art=path.match(/^\/(art|thumbs|medium)\/(\d+)\.webp$/),file=font?`apps/web/${font[1]}`:art?(art[1]==='art'?`data/images/${art[2]}.webp`:`runs/art/${art[1]}/${art[2]}.webp`):path==='/app.js'?'apps/web/app.js':path==='/style.css'?'apps/web/style.css':'apps/web/index.html';
  try{const bytes=await readFile(join(repository,file));response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':file.endsWith('.woff2')?'font/woff2':file.endsWith('.png')?'image/png':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});response.end(bytes);}
  catch{response.writeHead(404);response.end();}
  return true;
 };
 const server=gameServer({routes:[(request,response)=>routes[0]!(request,response),(request,response)=>routes[1]!(request,response),web],health:async()=>({})});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 const wallet=new WalletAuth({root,origin,now:()=>now,verify:()=>Promise.resolve(true)});
 const play=playRoutes({origin,auth:wallet,holders,career,metadata:records,connectionsAt:async atBlock=>new WitnessConnections({snapshot,metadata:records,atBlock}),cases,plays:new HolderPlays(root),
  rookies:new RookieDesk<PuzzleSession>({root,metadata,now:()=>now,secure:false}),now:()=>now,training:new TrainingDesk(randomBytes(32),()=>training),
  render:{issue:(value,issue,landscape)=>issueImage(root,value,issue,landscape),share:facts=>shareImage(root,facts)},
  history:()=>({history:trail.rows,times:new Map(trail.times)}),hunches:new HunchDesk(root),
  replay:async()=>({label:'REPLAY',caseLine:'A real sale, replayed.',witness:{tokenId:training.cast[0]!.tokenId,name:training.cast[0]!.name},statement:training.statements[0]!.line,receipt:training.receipts[0]!,inference:training.lie.inference})});
 routes.push(holderRoutes({origin,auth:wallet,roster:new DetectiveRoster({holders,career,metadata:records,now:()=>now}),now:()=>now}),play);
 return {server,origin,
  moveOwner:(tokenId:number,to:string)=>{moved.set(tokenId,to);},
  closeCase:()=>{published={...published,close:{...record.open!,hash:('0x'+'cc'.repeat(32)) as `0x${string}`}};},
  setNow:(value:number)=>{now=value;},
  async close(){play.close();await new Promise<void>((done,reject)=>{server.close(error=>error?reject(error):done());server.closeAllConnections();});},
 };
}
