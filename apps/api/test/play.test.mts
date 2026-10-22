import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test,expect} from 'vitest';
import {planFor} from '../../../packages/cases/src/puzzle.mts';
import {fixtureServer,puzzle,owners,holder} from './fixture.mts';

const stranger='0x000000000000000000000000000000000000dEaD';
async function harness(action:(ctx:{root:string;origin:string;post:(path:string,value:unknown,cookie?:string)=>Promise<Response>;get:(path:string,cookie?:string)=>Promise<Response>;signIn:(address:string)=>Promise<string>;moveOwner:(tokenId:number,to:string)=>void;closeCase:()=>void})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'chog-play-http-')),fixture=await fixtureServer(root),{origin}=fixture;
 const post=(path:string,value:unknown,cookie?:string)=>fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(value)});
 const get=(path:string,cookie?:string)=>fetch(origin+path,{headers:cookie?{cookie}:{}});
 const signIn=async(address:string)=>{const challenge=await (await post('/api/auth/nonce',{address})).json(),response=await post('/api/auth/verify',{nonce:challenge.nonce,signature:'0x'+'12'.repeat(65)});expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';')[0]!;};
 try{await action({root,origin,post,get,signIn,moveOwner:fixture.moveOwner,closeCase:fixture.closeCase});}
 finally{await fixture.close();await rm(root,{recursive:true,force:true});}
}
/** Plays the planned perfect route over HTTP: press where needed, present each breaking receipt, then solve. */
async function solve(post:(path:string,value:unknown,cookie?:string)=>Promise<Response>,cookie:string,plan:ReturnType<typeof planFor>,view:{state:Record<string,any>},tokenId?:number){
 let state=view.state,last:Record<string,any>=view;const send=async(action:Record<string,unknown>)=>{const response=await post('/api/case/action',{...(tokenId?{tokenId}:{}),action:{...action,revision:state.revision}},cookie);expect(response.status).toBe(200);last=await response.json();state=last.state;return last;};
 for(const lie of plan.lies){
  const statement=plan.statements.find(row=>row.id===lie.statementId)!;
  if(statement.slot==='followup'&&!state.statements.some((row:{id:string})=>row.id===statement.id))await send({type:'press',witness:lie.witness});
  const opened=state.receipts.find((row:{id:string})=>row.id===lie.receiptId);
  if(opened.sealed)await send({type:'open',receiptId:lie.receiptId});
  const after=await send({type:'present',statementId:lie.statementId,receiptId:lie.receiptId});expect(after.state.notice).toMatch(/^CAUGHT\. /);
 }
 return send({type:'solve',tiles:puzzle.key.answers});
}
const files=async(path:string)=>readdir(path).catch(()=>[] as string[]);

test('a visitor plays the full real case at the Rookie desk and nothing is written to careers, plays or stats',async()=>harness(async({root,post,get})=>{
 const start=await post('/api/rookie/start',{}),cookie=start.headers.get('set-cookie')!;
 expect(start.status).toBe(200);expect(cookie).toMatch(/^chog_noir_rookie=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax/);
 const view=await start.json();
 expect(view.mode).toBe('ROOKIE');expect(view.badge.label).toBe(`Rookie desk · bureau badge ${view.badge.name} · nothing you do here is kept.`);
 expect(puzzle.file.cast.map(row=>row.tokenId)).not.toContain(view.badge.tokenId);expect([6,8]).toContain(view.state.questions);
 expect(JSON.stringify(view)).not.toContain(puzzle.key.salt);expect(view.state.statements.every((row:{slot:string})=>row.slot==='opening')).toBe(true);
 await expect((await get('/api/case/'+puzzle.file.id+'/stats',cookie.split(';')[0])).status).toBe(403);
 const done=await solve(post,cookie.split(';')[0]!,planFor(puzzle,null),view);
 expect(done.state.done).toBe(true);expect(done.state.result.shareLabel).toBe('ROOKIE DESK');expect(done.invitation).toBe('Hold a Chog and it becomes your detective. Its career is kept on the token.');
 for(const panel of done.state.result.panels){expect(panel.label).toBe('CAUGHT — false statement');expect(panel.receipt.sources.length).toBeGreaterThan(0);}
 expect(JSON.stringify(done.state.result.truth)).not.toMatch(/false statement/i);
 expect((await get('/api/case/'+puzzle.file.id+'/stats',cookie.split(';')[0])).status).toBe(200);
 // Same browser, same day: no second rookie case.
 const again=await (await post('/api/rookie/start',{},cookie.split(';')[0])).json();expect(again.state.done).toBe(true);
 expect(await files(join(root,'runs/career'))).toEqual([]);expect(await files(join(root,'runs/play'))).toEqual([]);
 const board=await (await get('/api/precinct')).json();expect(board.tiles).toEqual([]);expect(board.rookieLine).toBe('1 rookie at the desk today');
}),180_000);

test('the Rookie desk allows twenty new browsers per network per day',async()=>harness(async({post})=>{
 for(let index=0;index<20;index++)expect((await post('/api/rookie/start',{})).status).toBe(200);
 const limited=await post('/api/rookie/start',{});expect(limited.status).toBe(429);expect((await limited.json()).code).toBe('ROOKIE_LIMIT');
}),180_000);

test('a holder plays a held Chog, its result is written to the token, and the board shows no spoilers',async()=>harness(async({root,post,get,signIn})=>{
 const cookie=await signIn(holder);
 const roster=await (await get('/api/me/chogs',cookie)).json();expect(roster.chogs.map((row:{tokenId:number})=>row.tokenId)).toContain(11);
 const start=await post('/api/case/start',{tokenId:11},cookie);expect(start.status).toBe(201);
 const view=await start.json();expect(view.mode).toBe('HOLDER');expect(view.detective.tokenId).toBe(11);
 expect(view.budget.total).toBe(view.state.questions);expect(view.budget.firstCaseBonus).toBe(2);
 for(const tag of view.known)expect(tag.tag).toMatch(/^Knows your Chog: /);
 const done=await solve(post,cookie,planFor(puzzle,11),view,11);
 expect(done.state.done).toBe(true);expect(done.state.result.solved).toBe(true);expect(done.transferredMidCase).toBe(false);
 const profile=await (await get('/api/chog/11')).json();
 expect(profile.career.solves).toBe(1);expect(profile.career.streak).toBe(1);expect(profile.results[0]).toMatchObject({caseId:puzzle.file.id,transferredMidCase:false});
 expect(profile.gallery.map((row:{tokenId:number})=>row.tokenId).sort()).toEqual([...new Set(planFor(puzzle,11).lies.map(row=>row.witness))].sort());
 const board=await (await get('/api/precinct')).json();
 expect(board.tiles).toHaveLength(1);expect(board.tiles[0]).toMatchObject({tokenId:11,liesCaught:planFor(puzzle,11).lies.length});expect(board.catches[0].text).toMatch(/ caught a liar · just now$/);
 const text=JSON.stringify(board);for(const statement of planFor(puzzle,11).statements)expect(text).not.toContain(statement.id);expect(text).not.toContain('"witness"');
 const stats=await (await get('/api/case/'+puzzle.file.id+'/stats?tokenId=11',cookie)).json();expect(stats.detectives).toBe(1);expect(stats.firstTryPercent).toBe(100);
 // One play per token per day, whichever wallet asks.
 const replay=await post('/api/case/start',{tokenId:11},await signIn(stranger));expect(replay.status).toBe(409);
 expect((await files(join(root,'runs/career'))).length).toBe(1);
}),180_000);

test('a Chog that leaves the wallet mid-case keeps its result on the token, marked transferred',async()=>harness(async({post,get,signIn,moveOwner})=>{
 const cookie=await signIn(holder),view=await (await post('/api/case/start',{tokenId:11},cookie)).json();
 moveOwner(11,stranger);
 const done=await solve(post,cookie,planFor(puzzle,11),view,11);
 expect(done.transferredMidCase).toBe(true);expect((await (await get('/api/chog/11')).json()).results[0].transferredMidCase).toBe(true);
}),180_000);

test('the bureau refuses wallets without that Chog, cross-site writes and early answer keys',async()=>harness(async({origin,post,get,signIn,closeCase})=>{
 const cookie=await signIn(stranger);
 const none=await post('/api/case/start',{tokenId:11},cookie);expect(none.status).toBe(403);expect((await none.json()).code).toBe('HOLDER_NO_CHOG');
 const other=await signIn(holder),notHeld=[...owners.values()].find(row=>row.owner!==holder)!.tokenId;
 expect((await (await post('/api/case/start',{tokenId:notHeld},other)).json()).code).toBe('HOLDER_NOT_OWNER');
 const cross=await fetch(origin+'/api/rookie/start',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:'{}'});expect(cross.status).toBe(403);
 const early=await (await get('/api/case/'+puzzle.file.id+'/public')).json();
 expect(early.key).toBeUndefined();expect(early.file).toBeUndefined();expect(JSON.stringify(early)).not.toContain(puzzle.key.salt);
 expect((await get('/api/issues/1')).status).toBe(404);
 closeCase();
 const closed=await (await get('/api/case/'+puzzle.file.id+'/public')).json();expect(closed.key.salt).toBe(puzzle.key.salt);
 const issue=await (await get('/api/issues/1')).json();expect(issue.reveal.panels.every((panel:{label:string;statement:string;receipt:{text:string}})=>panel.label==='CAUGHT — false statement'&&panel.statement&&panel.receipt.text)).toBe(true);
}),180_000);

test('issue art follows the same-panel rule, and share images are the player’s own facts within size limits',async()=>harness(async({post,get,signIn,closeCase})=>{
 const {issuePanels}=await import('../../../packages/art/src/render.mts');
 const panels=issuePanels(puzzle,{number:1,openTx:'0x'+'aa'.repeat(32),closeTx:'0x'+'cc'.repeat(32)}),plan=planFor(puzzle,null);
 const caught=panels.findIndex(panel=>panel.blocks.some(block=>block.value==='CAUGHT — false statement'));
 expect(caught).toBe(2);const values=panels[2]!.blocks.map(block=>block.value);
 expect(values).toContain(plan.statements.find(row=>row.id===plan.lies[0]!.statementId)!.line);expect(values).toContain(puzzle.file.receipts.find(row=>row.id===plan.lies[0]!.receiptId)!.text);
 for(const [index,panel] of panels.entries())if(index!==2)for(const lie of plan.lies)expect(JSON.stringify(panel)).not.toContain(lie.falseValue);
 const cookie=await signIn(holder),view=await (await post('/api/case/start',{tokenId:11},cookie)).json();
 expect((await get('/api/case/share-image?tokenId=11',cookie)).status).toBe(403);
 await solve(post,cookie,planFor(puzzle,11),view,11);
 const share=await get('/api/case/share-image?tokenId=11',cookie),bytes=Buffer.from(await share.arrayBuffer());
 expect(share.headers.get('content-type')).toBe('image/png');expect(bytes.length).toBeLessThanOrEqual(400_000);expect(bytes.readUInt32BE(16)).toBe(1200);expect(bytes.readUInt32BE(20)).toBe(630);
 expect((await get('/api/issues/1/image')).status).toBe(404);
 closeCase();
 for(const [format,width,height] of [['',1080,1350],['?format=landscape',1600,900]] as const){
  const image=Buffer.from(await (await get('/api/issues/1/image'+format)).arrayBuffer());expect(image.length).toBeLessThanOrEqual(400_000);expect(image.readUInt32BE(16)).toBe(width);expect(image.readUInt32BE(20)).toBe(height);
 }
}),300_000);
