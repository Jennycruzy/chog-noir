import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {AuthError,type WalletAuth} from '../../../packages/auth/src/auth.mts';
import type {HolderDirectory} from '../../../packages/auth/src/holders.mts';
import type {MetadataRecord} from '../../../packages/auth/src/roster.mts';
import type {WitnessConnections} from '../../../packages/auth/src/connections.mts';
import {CareerError,careerStatus,type CareerStore} from '../../../packages/career/src/store.mts';
import {planFor,PuzzleError,type PuzzleCase} from '../../../packages/cases/src/puzzle.mts';
import {applyPuzzleAction,createPuzzleSession,puzzleScore,viewPuzzleSession,caseReveal,PuzzleActionError,type PuzzleAction,type PuzzleSession} from '../../../packages/game/src/puzzle-session.mts';
import {RookieError,type RookieDesk} from '../../../packages/game/src/rookie.mts';
import {PlayError,type HolderPlays,type HolderPlay} from '../../../packages/game/src/plays.mts';
import {PlayerBusy} from '../../../packages/game/src/player-lock.mts';
import {detectiveFor,questionBudget,DetectiveDataError} from '../../../packages/traits/src/detective.mts';
import type {PuzzlePublication} from '../../../packages/publishing/src/puzzles.mts';
import {TrainingError,type TrainingDesk} from '../../../packages/game/src/training.mts';
import type {ShareFacts} from '../../../packages/art/src/render.mts';

export interface CaseSource {
 list():Promise<PuzzlePublication[]>;
 current(now:number):Promise<{record:PuzzlePublication;puzzle:PuzzleCase}|null>;
 byId(id:string):Promise<{record:PuzzlePublication;puzzle:PuzzleCase}|null>;
}
export interface PlayOptions {
 origin:string;auth:WalletAuth;holders:HolderDirectory;career:CareerStore;metadata:ReadonlyMap<number,MetadataRecord>;
 connectionsAt:(atBlock:number)=>Promise<WitnessConnections>;cases:CaseSource;plays:HolderPlays;rookies:RookieDesk<PuzzleSession>;
 trustProxy?:boolean;now?:()=>number;verify?:(record:PuzzlePublication,file:PuzzleCase['file']|null)=>Promise<unknown>;
 training?:TrainingDesk;replay?:()=>Promise<ReplayPanel|null>;optOut?:(address:string)=>Promise<{recordedAt:string}>;
 render?:{issue:(puzzle:PuzzleCase,issue:{number:number;openTx:string;closeTx:string},landscape:boolean)=>Promise<Buffer>;share:(facts:ShareFacts)=>Promise<Buffer>};
}
/** A real caught lie for the front door: the false statement, the exact CAUGHT label and the breaking receipt, together. */
export interface ReplayPanel {label:'REPLAY';caseLine:string;witness:{tokenId:number;name:string};statement:string;receipt:{text:string;sources:unknown[]};inference:string}
const cookieValue=(request:IncomingMessage,name:string)=>{
 const values=(request.headers.cookie??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'='));
 if(values.length>1)throw new PlayError('SESSION_COOKIE_INVALID','Open the bureau again.',400);return values[0]?.slice(name.length+1);
};
const tokenParameter=(value:unknown)=>{const id=Number(value);if(!Number.isSafeInteger(id)||id<1||id>1969)throw new PlayError('HOLDER_TOKEN_INVALID','Choose a Chog from the collection.');return id;};
const ago=(seconds:number)=>seconds<60?'just now':seconds<3600?Math.floor(seconds/60)+' min ago':Math.floor(seconds/3600)+' h ago';

/** Case summary that is safe before close: no statements, receipts, tiles' answers or key. */
function caseSummary(record:PuzzlePublication,puzzle:PuzzleCase){
 const {file}=puzzle;
 return {id:file.id,number:record.number,day:file.day,weekday:new Date(file.day+'T00:00:00Z').toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'}),title:file.title,setup:file.setup,ruleLine:file.ruleLine,
  subject:file.subject,cast:file.cast.map(({tokenId,name,nickname})=>({tokenId,name,nickname})),opensAt:file.opensAt,closesAt:file.closesAt,answerHash:record.answerHash,contract:record.contract,publishedAt:record.publishedAt,openTx:record.open?.hash??null,closeTx:record.close?.hash??null,closed:!!record.close};
}

export function playRoutes(options:PlayOptions){
 const origin=new URL(options.origin).origin,now=options.now??Date.now,rateSalt=randomBytes(32).toString('hex');
 const rates=new Map<string,{count:number;until:number}>(),streams=new Set<ServerResponse>();
 function network(request:IncomingMessage){
  let ip=request.socket.remoteAddress??'';
  if(options.trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)&&typeof request.headers['x-real-ip']==='string')ip=request.headers['x-real-ip'];
  if(!isIP(ip))throw new PlayError('NETWORK_INVALID','The bureau could not check this network.',503);return ip;
 }
 function rate(request:IncomingMessage){
  const at=now();for(const [key,value] of rates)if(value.until<=at)rates.delete(key);
  const key=createHash('sha256').update(rateSalt+network(request)).digest('hex'),value=rates.get(key)??{count:0,until:at+60_000};
  if(value.count>=60||rates.size>=10_000&&!rates.has(key))throw new PlayError('RATE_LIMIT','Please wait a minute before trying again.',429);
  value.count++;rates.set(key,value);
 }
 function reply(response:ServerResponse,status:number,value:Record<string,unknown>,sources:unknown[]=[]){
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  response.end(JSON.stringify({v:2,generatedAt:new Date(now()).toISOString(),sources,...value}));
 }
 async function body(request:IncomingMessage){
  if(!request.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new PlayError('BODY_INVALID','Send a JSON request.',415);
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;if(length>8192)throw new PlayError('BODY_TOO_LARGE','The request is too large.',413);chunks.push(bytes);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}catch{throw new PlayError('BODY_INVALID','Send a valid JSON request.');}
 }
 const metadataFor=(tokenId:number)=>{const record=options.metadata.get(tokenId);if(!record)throw new PlayError('HOLDER_METADATA_MISSING','This Chog could not be checked.',503);return record;};
 async function wallet(request:IncomingMessage){const session=await options.auth.session(cookieValue(request,'chog_noir_session'));if(!session)throw new AuthError('AUTH_SESSION_REQUIRED','Connect your wallet first.');return session.address;}
 async function today(){const current=await options.cases.current(now());if(!current)throw new PlayError('CASE_NOT_OPEN','No case is open right now. A new case opens at 00:20 UTC.',404);return current;}
 const seconds=()=>Math.floor(now()/1000);

 function detectivePanel(play:HolderPlay){
  const detective=detectiveFor(play.tokenId,metadataFor(play.tokenId).metadata);
  return {tokenId:play.tokenId,name:detective.name,skill:detective.skill,skillName:detective.skillName,skillLine:detective.skillLine,uses:detective.uses,questions:play.session.initialQuestions,founder:play.founder,side:detective.side,moneyTalk:detective.moneyTalk,special:detective.special};
 }
 function holderView(puzzle:PuzzleCase,record:PuzzlePublication,play:HolderPlay){
  return {mode:'HOLDER',case:caseSummary(record,puzzle),state:viewPuzzleSession(puzzle,play.session),detective:detectivePanel(play),
   known:play.known.map(row=>({witness:row.witness,tag:'Knows your Chog: '+row.reason})),transferredMidCase:play.transferredMidCase};
 }

 /** Finishes a holder case on the token. The Chog's owner is re-read from chain; a moved Chog keeps its result, marked. */
 async function finish(puzzle:PuzzleCase,record:PuzzlePublication,play:HolderPlay){
  const {transferredMidCase}=await options.holders.submission(play.wallet,play.tokenId);
  const plan=planFor(puzzle,play.tokenId),score=puzzleScore(puzzle,play.session),caught=plan.lies.filter(lie=>play.session.caught.includes(lie.id));
  play.transferredMidCase=transferredMidCase;play.finishedAt=now();
  await options.career.finish({mode:'HOLDER',tokenId:play.tokenId,wallet:play.wallet,founder:play.founder,result:{caseId:puzzle.file.id,day:puzzle.file.day,grade:score.grade,score:score.score,
   perfect:caught.length===plan.lies.length&&play.session.solutionAttempt===1&&play.session.wrongPresents===0,solved:play.session.solved,lies:caught.map(lie=>lie.id),caught:caught.map(lie=>lie.witness),transferredMidCase}});
 }

 async function startHolder(request:IncomingMessage,input:Record<string,unknown>){
  const address=await wallet(request),tokenId=tokenParameter(input.tokenId),{record,puzzle}=await today();
  return options.plays.locked(puzzle.file.id,tokenId,async()=>{
   const existing=await options.plays.read(puzzle.file.id,tokenId);
   if(existing){if(existing.wallet!==address)throw new PlayError('PLAY_ALREADY_TODAY',"This Chog already worked today's case. Back tomorrow at 00:20 UTC.",409);return holderView(puzzle,record,existing);}
   const chog=await options.holders.start(address,tokenId),started=now();
   await options.career.start({mode:'HOLDER',tokenId,wallet:address,caseId:puzzle.file.id,day:puzzle.file.day,now:started});
   const profile=await options.career.profile(tokenId),detective=detectiveFor(tokenId,metadataFor(tokenId).metadata);
   const firstCase=profile.duties.length===1&&profile.duties[0]!.caseId===puzzle.file.id;
   const budget=questionBudget({skill:detective.skill,heldSince:chog.heldSince,now:Math.floor(started/1000),founder:chog.founder,firstCase});
   // Links are read at the case cutoff, so later transfers cannot create an earlier friendship.
   const links=await options.connectionsAt(puzzle.file.cutoff.block);
   const known=puzzle.file.cast.filter(row=>row.tokenId!==tokenId).flatMap(row=>{const first=links.between(tokenId,row.tokenId)[0];return first?[{witness:row.tokenId,kind:first.kind,reason:first.reason}]:[];});
   const session=createPuzzleSession(puzzle,{tokenId,name:detective.name,skill:detective.skill,uses:detective.uses,questions:budget.total,moneyTalk:detective.moneyTalk,side:detective.side,freePress:known.map(row=>row.witness)},'HOLDER');
   const play:HolderPlay={v:1,caseId:puzzle.file.id,tokenId,wallet:address,founder:chog.founder,startedAt:started,session,known,catches:[],finishedAt:null,transferredMidCase:false};
   await options.plays.create(play);return {...holderView(puzzle,record,play),budget};
  });
 }
 function puzzleAction(input:Record<string,unknown>):PuzzleAction{
  const action=input.action as Record<string,unknown>|undefined;
  if(!action||typeof action!=='object'||Array.isArray(action)||!Number.isSafeInteger(action.revision))throw new PlayError('ACTION_INVALID','Choose a case action.');
  const revision=action.revision as number;
  switch(action.type){
   case 'press':return {type:'press',witness:Number(action.witness),revision};
   case 'present':if(typeof action.statementId!=='string'||typeof action.receiptId!=='string')break;return {type:'present',statementId:action.statementId,receiptId:action.receiptId,revision};
   case 'open':if(typeof action.receiptId!=='string')break;return {type:'open',receiptId:action.receiptId,revision};
   case 'skill':return {type:'skill',revision,...(typeof action.receiptId==='string'?{receiptId:action.receiptId}:{}),...(typeof action.statementId==='string'?{statementId:action.statementId}:{})};
   case 'solve':if(!action.tiles||typeof action.tiles!=='object'||Array.isArray(action.tiles)||Object.values(action.tiles).some(value=>typeof value!=='string'))break;return {type:'solve',tiles:action.tiles as Record<string,string>,revision};
  }
  throw new PlayError('ACTION_INVALID','Choose a case action.');
 }
 async function holderAction(request:IncomingMessage,input:Record<string,unknown>){
  const address=await wallet(request),tokenId=tokenParameter(input.tokenId),action=puzzleAction(input),{record,puzzle}=await today();
  return options.plays.locked(puzzle.file.id,tokenId,async()=>{
   const play=await options.plays.read(puzzle.file.id,tokenId);
   if(!play)throw new PlayError('CASE_NOT_STARTED','Take the case with this Chog first.',404);
   if(play.wallet!==address)throw new AuthError('HOLDER_NOT_OWNER',"This Chog isn't in your wallet any more.",403);
   const before=play.session.caught.length;play.session=applyPuzzleAction(puzzle,play.session,action,seconds());
   for(let index=before;index<play.session.caught.length;index++)play.catches.push(now());
   if(play.session.done&&play.finishedAt===null)await finish(puzzle,record,play);
   await options.plays.save(play);return holderView(puzzle,record,play);
  });
 }
 const rookieCase=(puzzle:PuzzleCase)=>({id:puzzle.file.id,day:puzzle.file.day,opensAt:puzzle.file.opensAt*1000,closesAt:puzzle.file.closesAt*1000,salt:puzzle.key.salt,cast:puzzle.file.cast.map(row=>row.tokenId)});
 const rookieView=(puzzle:PuzzleCase,record:PuzzlePublication,session:{badge:{tokenId:number;name:string;skill:string;skillName:string;uses:number;questions:number;label:string};state:PuzzleSession})=>({mode:'ROOKIE',case:caseSummary(record,puzzle),state:viewPuzzleSession(puzzle,session.state),badge:session.badge,
  invitation:session.state.done?'Hold a Chog and it becomes your detective. Its career is kept on the token.':null});
 async function startRookie(request:IncomingMessage,response:ServerResponse){
  const {record,puzzle}=await today(),browserToken=cookieValue(request,'chog_noir_rookie');
  const started=await options.rookies.start(rookieCase(puzzle),{...(browserToken?{browserToken}:{}),ip:network(request),create:badge=>createPuzzleSession(puzzle,{tokenId:badge.tokenId,name:badge.name,skill:badge.skill,uses:badge.uses,questions:badge.questions,moneyTalk:false,side:null,freePress:[]},'ROOKIE')});
  response.setHeader('set-cookie',options.rookies.cookie(started.token));
  return rookieView(puzzle,record,started.session);
 }
 async function rookieAction(request:IncomingMessage,input:Record<string,unknown>){
  const token=cookieValue(request,'chog_noir_rookie');if(!token)throw new RookieError('ROOKIE_SESSION_INVALID','Open the Rookie desk again.',401);
  const action=puzzleAction(input),{record,puzzle}=await today();
  const session=await options.rookies.action(rookieCase(puzzle),token,action.revision,state=>{const next=applyPuzzleAction(puzzle,state,action,seconds());return {state:next,done:next.done};});
  return rookieView(puzzle,record,session);
 }

 async function precinct(){
  const current=await options.cases.current(now());
  if(!current)return {case:null,tiles:[],catches:[],rookies:0,empty:'No case is open right now. A new case opens at 00:20 UTC.'};
  const {record,puzzle}=current,plays=await options.plays.all(puzzle.file.id),at=now();
  const tiles=await Promise.all(plays.map(async play=>{
   const detective=detectiveFor(play.tokenId,metadataFor(play.tokenId).metadata),status=careerStatus(await options.career.profile(play.tokenId),puzzle.file.day,play.founder);
   return {tokenId:play.tokenId,name:detective.name,rank:status.rank,streak:status.streak,liesCaught:play.catches.length,grade:play.finishedAt===null?null:puzzleScore(puzzle,play.session).grade,clockedInAt:play.startedAt};
  }));
  // Catches name the detective and the time only; never the witness or the statement.
  const catches=plays.flatMap(play=>play.catches.map(time=>({tokenId:play.tokenId,name:tiles.find(row=>row.tokenId===play.tokenId)!.name,at:time}))).sort((a,b)=>b.at-a.at).slice(0,20).map(row=>({...row,text:row.name+' caught a liar · '+ago(Math.max(0,Math.floor((at-row.at)/1000)))}));
  const rookies=await options.rookies.count(rookieCase(puzzle));
  return {case:caseSummary(record,puzzle),tiles,catches,rookies,rookieLine:rookies?rookies+(rookies===1?' rookie':' rookies')+' at the desk today':null,empty:tiles.length?null:'First on duty today. The board fills as detectives clock in.'};
 }
 async function stats(caseId:string,request:IncomingMessage,url:URL){
  const found=await options.cases.byId(caseId);if(!found)throw new PlayError('CASE_NOT_FOUND','That case is not published.',404);
  const {puzzle}=found;let finished=false;
  if(url.searchParams.has('tokenId')){const play=await options.plays.read(caseId,tokenParameter(url.searchParams.get('tokenId')));finished=!!play&&play.finishedAt!==null&&play.wallet===await wallet(request);}
  else{const token=cookieValue(request,'chog_noir_rookie');if(token)finished=!!(await options.rookies.peek(rookieCase(puzzle),token))?.done;}
  if(!finished&&!found.record.close)throw new PlayError('STATS_LOCKED','Global results appear after you submit your own solution.',403);
  // Holder results only: the Rookie desk is never counted in stats.
  const done=(await options.plays.all(caseId)).filter(play=>play.finishedAt!==null),share=(count:number)=>done.length?Math.round(count*100/done.length):null;
  return {caseId,detectives:done.length,lies:planFor(puzzle,null).lies.map(lie=>({id:lie.id,caughtPercent:share(done.filter(play=>play.session.caught.includes(lie.id)).length)})),firstTryPercent:share(done.filter(play=>play.session.solutionAttempt===1).length)};
 }
 async function closedCases(){
  const rows=[];
  for(const record of (await options.cases.list()).filter(row=>row.close))rows.push({record,puzzle:(await options.cases.byId(record.id))!.puzzle});
  return rows.sort((a,b)=>b.record.number-a.record.number);
 }
 async function profile(tokenId:number){
  const record=metadataFor(tokenId),detective=detectiveFor(tokenId,record.metadata),career=await options.career.profile(tokenId),day=new Date(now()).toISOString().slice(0,10);
  const closed=await closedCases(),appeared=closed.filter(row=>row.puzzle.file.cast.some(member=>member.tokenId===tokenId));
  const lied=appeared.filter(row=>planFor(row.puzzle,null).lies.some(lie=>lie.witness===tokenId));
  const results=career.duties.filter(duty=>duty.result).map(duty=>{const chain=closed.find(row=>row.record.id===duty.caseId)?.record;return {caseId:duty.caseId,day:duty.day,grade:duty.result!.grade,transferredMidCase:duty.result!.transferredMidCase,recordTx:chain?.solves?.length?chain.solves.map(receipt=>receipt.hash):null};});
  // Founder status needs a fresh owner index; when it is updating the profile says so instead of guessing.
  const held=await options.holders.token(tokenId).catch(error=>{if(error instanceof AuthError&&error.status===503)return null;throw error;});
  return {tokenId,name:detective.name,traits:detective.cleanTraits,skill:{name:detective.skillName,line:detective.skillLine,uses:detective.uses},founder:held?held.founder:null,
   career:{...careerStatus(career,day,held?.founder??false),grades:career.grades,liesCaught:career.liesCaught,perfectCases:career.perfectCases,firstCase:career.duties[0]?.day??null},
   gallery:career.gallery.map(id=>({tokenId:id,name:options.metadata.get(id)?.metadata.name??null})),results,
   witness:{called:appeared.length,lied:lied.length},issues:appeared.map(row=>({number:row.record.number,day:row.record.day,title:row.puzzle.file.title,caseId:row.record.id}))};
 }

 const images=new Map<string,Promise<Buffer>>();
 function png(response:ServerResponse,bytes:Buffer,shared:boolean,name:string){
  response.writeHead(200,{'content-type':'image/png','cache-control':shared?'public, max-age=86400':'private, no-store','content-disposition':`inline; filename="${name}.png"`,'x-content-type-options':'nosniff'});response.end(bytes);
 }
 async function issuePng(number:number,landscape:boolean){
  const found=(await closedCases()).find(row=>row.record.number===number);if(!found)throw new PlayError('ISSUE_NOT_FOUND','That issue has not been published.',404);
  if(!options.render)throw new PlayError('RENDER_UNAVAILABLE','Issue images are unavailable.',503);
  const key=found.record.answerHash+':'+(landscape?'landscape':'portrait');
  if(!images.has(key))images.set(key,options.render.issue(found.puzzle,{number,openTx:found.record.open!.hash,closeTx:found.record.close!.hash},landscape).catch(error=>{images.delete(key);throw error;}));
  return images.get(key)!;
 }
 /** The player's own finished case only; the image shows the share grid's facts and no answer. */
 async function sharePng(request:IncomingMessage,url:URL){
  if(!options.render)throw new PlayError('RENDER_UNAVAILABLE','Share images are unavailable.',503);
  const {record,puzzle}=await today();let view:ReturnType<typeof holderView>|ReturnType<typeof rookieView>;
  if(url.searchParams.has('tokenId')){const tokenId=tokenParameter(url.searchParams.get('tokenId')),address=await wallet(request),play=await options.plays.read(puzzle.file.id,tokenId);if(!play||play.wallet!==address)throw new PlayError('CASE_NOT_STARTED','Take the case with this Chog first.',404);view=holderView(puzzle,record,play);}
  else{const token=cookieValue(request,'chog_noir_rookie'),session=token?await options.rookies.peek(rookieCase(puzzle),token):null;if(!session)throw new RookieError('ROOKIE_SESSION_INVALID','Open the Rookie desk again.',401);view=rookieView(puzzle,record,session);}
  const state=view.state;if(!state.done||!state.result)throw new PlayError('SHARE_LOCKED','Finish the case to share it.',403);
  const holder=view.mode==='HOLDER'?(view as ReturnType<typeof holderView>):null;
  const status=holder?careerStatus(await options.career.profile(holder.detective.tokenId),puzzle.file.day,holder.detective.founder):null;
  return options.render.share({number:record.number,weekday:caseSummary(record,puzzle).weekday,detective:holder?`${holder.detective.name}${holder.detective.founder?' · Founder':''} · ${status!.rank}`:'ROOKIE DESK',
   liesCaught:state.caught.length,lies:state.result.panels.length,solved:state.result.solved,questionsLeft:state.questions,streak:status?status.streak:null,subject:puzzle.file.subject.tokenId});
 }
 const timer=setInterval(()=>{if(!streams.size)return;void precinct().then(value=>{const text='event: precinct\ndata: '+JSON.stringify(value)+'\n\n';for(const stream of streams)stream.write(text);}).catch(()=>{});},5000);timer.unref();

 const handler=async(request:IncomingMessage,response:ServerResponse):Promise<boolean>=>{
  // Game routes live only under /api; page addresses such as /chog/11 belong to the site.
  const url=new URL(request.url??'/','http://localhost');if(!url.pathname.startsWith('/api/'))return false;const path=url.pathname.slice(4);
  const route=path.match(/^\/(case\/today|case\/start|case\/action|case\/state|rookie\/start|precinct|precinct\/stream|issues|replay|training\/start|training\/action|optout)$/)?.[1]??(/^\/case\/case-[a-f0-9]{24}\/(public|stats)$/.test(path)?'case-detail':/^\/chog\/\d+$/.test(path)?'chog':/^\/issues\/\d+$/.test(path)?'issue':/^\/issues\/\d+\/image$/.test(path)?'issue-image':path==='/case/share-image'?'share-image':/^\/verify\/case-[a-f0-9]{24}$/.test(path)?'verify':null);
  if(!route)return false;
  try{
   const post=['case/start','case/action','rookie/start','training/start','training/action','optout'].includes(route);
   if(request.method!==(post?'POST':'GET')){response.setHeader('allow',post?'POST':'GET');throw new PlayError('METHOD_INVALID','Use the correct request method.',405);}
   if(post){if(request.headers.origin!==origin)throw new PlayError('ORIGIN_INVALID','Play from the bureau website.',403);rate(request);}
   if(route==='case/today'){const current=await options.cases.current(now());return reply(response,200,{case:current?caseSummary(current.record,current.puzzle):null,nextOpensAt:current?null:Math.ceil((now()/1000-1200)/86400)*86400+1200}),true;}
   if(route==='case/start')return reply(response,201,await startHolder(request,await body(request))),true;
   if(route==='rookie/start')return reply(response,200,await startRookie(request,response)),true;
   if(route==='case/action'){const input=await body(request);return reply(response,200,input.tokenId===undefined?await rookieAction(request,input):await holderAction(request,input)),true;}
   if(route==='case/state'){const tokenId=tokenParameter(url.searchParams.get('tokenId')),address=await wallet(request),{record,puzzle}=await today(),play=await options.plays.read(puzzle.file.id,tokenId);if(!play||play.wallet!==address)throw new PlayError('CASE_NOT_STARTED','Take the case with this Chog first.',404);return reply(response,200,holderView(puzzle,record,play)),true;}
   if(route==='precinct')return reply(response,200,await precinct()),true;
   if(route==='replay'){
    // The newest closed issue when one exists; until then a real archived case, labelled REPLAY.
    const latest=(await closedCases())[0];
    if(latest){const panel=caseReveal(latest.puzzle).panels[0]!,witness=latest.puzzle.file.cast.find(row=>row.tokenId===panel.witness)!;return reply(response,200,{label:'REPLAY',caseLine:`Issue #${latest.record.number} · ${latest.puzzle.file.title}`,witness:{tokenId:witness.tokenId,name:witness.name},statement:panel.statement,receipt:{text:panel.receipt.text,sources:panel.receipt.sources},inference:panel.inference}),true;}
    const saved=await options.replay?.();if(!saved)throw new PlayError('REPLAY_UNAVAILABLE','No replay is ready yet.',404);return reply(response,200,{...saved}),true;
   }
   if(route==='training/start'){if(!options.training)throw new TrainingError('TRAINING_UNAVAILABLE','The training case is being prepared.',503);return reply(response,200,options.training.start()),true;}
   if(route==='training/action'){if(!options.training)throw new TrainingError('TRAINING_UNAVAILABLE','The training case is being prepared.',503);const input=await body(request);return reply(response,200,options.training.act(input.token,(input.action??{}) as Record<string,unknown>)),true;}
   if(route==='optout'){
    // The wallet session is the signature: only the signed-in wallet can opt itself out.
    const address=await wallet(request);if(!options.optOut)throw new PlayError('OPTOUT_UNAVAILABLE','Opt-out is unavailable right now.',503);
    return reply(response,200,{address,...await options.optOut(address),message:'Recorded. This wallet will be left out of new cases within 24 hours.'}),true;
   }
   if(route==='precinct/stream'){
    if(streams.size>=200)throw new PlayError('STREAM_BUSY','The board is busy. Refresh shortly.',429);
    response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no'});response.write('event: precinct\ndata: '+JSON.stringify(await precinct())+'\n\n');
    streams.add(response);request.on('close',()=>streams.delete(response));return true;
   }
   if(route==='case-detail'){
    const [,, id,kind]=path.split('/');
    if(kind==='stats')return reply(response,200,await stats(id!,request,url)),true;
    const found=await options.cases.byId(id!);if(!found)throw new PlayError('CASE_NOT_FOUND','That case is not published.',404);
    const {record,puzzle}=found;
    // The key and statements are never sent before the case closes and its key is revealed on chain.
    return reply(response,200,{case:caseSummary(record,puzzle),...(record.close?{file:puzzle.file,key:puzzle.key,reveal:caseReveal(puzzle),castTx:record.cast?.hash??null,solveTxs:record.solves?.map(row=>row.hash)??[]}:{})},record.open?[{kind:'TRANSACTION',tx:record.open.hash}]:[]),true;
   }
   if(route==='issues'){const closed=await closedCases();return reply(response,200,{issues:closed.map(({record,puzzle})=>({number:record.number,day:record.day,caseId:record.id,title:puzzle.file.title,subject:puzzle.file.subject,cast:puzzle.file.cast.map(({tokenId,name})=>({tokenId,name})),openTx:record.open!.hash,closeTx:record.close!.hash}))}),true;}
   if(route==='issue'){const number=Number(path.split('/')[2]),found=(await closedCases()).find(row=>row.record.number===number);if(!found)throw new PlayError('ISSUE_NOT_FOUND','That issue has not been published.',404);const {record,puzzle}=found;return reply(response,200,{number,case:caseSummary(record,puzzle),reveal:caseReveal(puzzle),openTx:record.open!.hash,closeTx:record.close!.hash}),true;}
   if(route==='chog')return reply(response,200,await profile(tokenParameter(path.split('/')[2]))),true;
   if(route==='issue-image'){const number=Number(path.split('/')[2]),landscape=url.searchParams.get('format')==='landscape';return png(response,await issuePng(number,landscape),true,`chog-noir-issue-${number}${landscape?'-landscape':''}`),true;}
   if(route==='share-image')return png(response,await sharePng(request,url),false,'chog-noir-result'),true;
   if(route==='verify'){
    const found=await options.cases.byId(path.split('/')[2]!);if(!found)throw new PlayError('CASE_NOT_FOUND','No published case has this identifier.',404);
    if(!options.verify)throw new PlayError('VERIFY_UNAVAILABLE','Chain verification is unavailable.',503);
    try{return reply(response,200,{result:await options.verify(found.record,found.record.close?found.puzzle.file:null)}),true;}
    catch{throw new PlayError('VERIFY_UNAVAILABLE','Chain verification could not complete. No pass is claimed. Try again.',503);}
   }
   return false;
  }catch(error){
   if(error instanceof AuthError||error instanceof PlayError||error instanceof PuzzleActionError||error instanceof RookieError||error instanceof TrainingError)reply(response,error.status,{code:error.code,error:error.message});
   else if(error instanceof CareerError)reply(response,error.code==='PLAY_ALREADY_TODAY'?409:400,{code:error.code,error:error.message});
   else if(error instanceof PlayerBusy)reply(response,409,{code:'CASE_BUSY',error:'Your last action is still being saved. Try again.'});
   else if(error instanceof DetectiveDataError||error instanceof PuzzleError)reply(response,503,{code:error.code,error:'This case could not be checked. Try again shortly.'});
   else{console.error('PLAY_REQUEST_FAILED',error instanceof Error?error.message.split(':')[0]:'unknown');reply(response,503,{code:'BUREAU_UNAVAILABLE',error:'The bureau is temporarily unavailable. Your last saved progress is safe. Try again.'});}
   return true;
  }
 };
 return Object.assign(handler,{close(){clearInterval(timer);for(const stream of streams)stream.end();streams.clear();}});
}
