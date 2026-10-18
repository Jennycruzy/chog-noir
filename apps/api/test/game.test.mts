import {test,expect,beforeAll,afterAll} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {gameServer} from '../src/game.mts';
import {draft,partner} from '../../../packages/game/test/fixture.mts';
let root:string,origin:string,cookie:string;
let server:ReturnType<typeof gameServer>;
const options=()=>({root,cases:[draft],partners:[partner],secure:false});
async function launch(){server=gameServer(options());await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;}
async function stop(){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
const get=(path:string)=>fetch(origin+path,{headers:{cookie}});
const post=(path:string,input:unknown,extra:Record<string,string>={})=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',cookie,...extra},body:JSON.stringify(input)});
async function start(){const response=await post('/api/session',{caseId:draft.public.id,partnerId:partner.tokenId});cookie=response.headers.get('set-cookie')!.split(';')[0]!;return response;}
beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'chog-game-test-'));cookie='';await launch();},30_000);
afterAll(async()=>{await stop();await rm(root,{recursive:true,force:true});},30_000);
test('catalogue and health never serialize private draft contents',async()=>{
 const response=await get('/api/cases'),text=await response.text();expect(response.status).toBe(200);
 expect(response.headers.get('cache-control')).toBe('no-store');
 expect(text).not.toContain('salt');expect(text).not.toContain('testimony');expect(text).not.toContain('ledger');
 expect((await (await get('/health')).json()).mode).toBe('archive_preview');
});
test('session cookie is HttpOnly and initial response omits sealed facts',async()=>{
 const response=await start(),text=await response.text();expect(response.status).toBe(201);
 expect(response.headers.get('set-cookie')).toContain('HttpOnly');expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
 expect(text).not.toContain('"key"');expect(text).not.toContain('"salt"');
 for(const fact of draft.public.ledger.filter(item=>item.sealed))expect(text).not.toContain(fact.text);
});
test('concurrent duplicate actions charge once and progress survives a server restart',async()=>{
 await start();const input={type:'ask',tokenId:draft.public.cast[0]!.tokenId,revision:0};
 const responses=await Promise.all([post('/api/session/action',input),post('/api/session/action',input)]);
 expect(responses.map(item=>item.status).sort()).toEqual([200,409]);
 await stop();await launch();
 const saved=await (await get('/api/session')).json();expect(saved.plays).toBe(7);expect(saved.revision).toBe(1);expect(saved.testimony).toHaveLength(1);
});
test('cross-origin writes, invalid cookie paths, invalid JSON and unknown actions fail safely',async()=>{
 expect((await post('/api/session',{caseId:draft.public.id,partnerId:1},{origin:'https://other.example'})).status).toBe(403);
 expect((await post('/api/session',{}, {'sec-fetch-site':'cross-site'})).status).toBe(403);
 expect((await fetch(origin+'/api/session',{headers:{cookie:'chog_session=../../secret'}})).status).toBe(404);
 expect((await fetch(origin+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status).toBe(400);
 expect((await post('/api/session/action',{type:'change-score',revision:1})).status).toBe(400);
 expect((await get('/api/../../.env')).status).toBe(404);
});
test('HTTP flow catches a lie, scores a complete case, then locks the submission',async()=>{
 await start();let revision=0;
 const act=async(action:Record<string,unknown>)=>{
  const response=await post('/api/session/action',{revision,...action});expect(response.status).toBe(200);const state=await response.json();revision=state.revision;return state;
 };
 const lie=draft.private.key.lie;
 await act({type:'ask',tokenId:lie.witness});await act({type:'power',factId:lie.ledgerId});
 await act({type:'accuse',tokenId:lie.witness,factId:lie.ledgerId});
 const state=await act({type:'submit',answers:draft.private.key.answers});
 expect(state.result.score).toBe(570);expect(state.result.grade).toBe('A');expect(state.result.verification.salt).toBe(draft.private.salt);
 expect((await post('/api/session/action',{revision,type:'submit',answers:draft.private.key.answers})).status).toBe(400);
});
