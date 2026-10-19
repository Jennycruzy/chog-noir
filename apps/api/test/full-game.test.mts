import {test,expect,beforeAll,afterAll} from 'vitest';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {gameServer} from '../src/game.mts';
import {draft as original,partner} from '../../../packages/game/test/fixture.mts';
import {buildMemories} from '../../../packages/witness/src/facts.mts';
import type {Metadata} from '../../../packages/cases/src/build.mts';
import type {EnrichedEvent} from '../../../packages/core/src/enrich.mts';
const fixture=JSON.parse(await readFile(new URL('../../../packages/cases/test/fixtures/sales.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const saved=JSON.parse(await readFile(new URL('../../../packages/cases/test/fixtures/metadata.json',import.meta.url),'utf8')) as Record<string,Metadata>;
const metadata=new Map(Object.entries(saved).map(([id,item])=>[Number(id),item]));
const draft=structuredClone(original);draft.private.facts=buildMemories(draft,fixture.rows,new Map(fixture.times),metadata);
const pool=[partner,{...partner,tokenId:2,power:'ANALYST' as const},{...partner,tokenId:3,power:'EMPATH' as const},{...partner,tokenId:4,power:'TAKES_ONE' as const}];
let root:string,origin:string,server:ReturnType<typeof gameServer>;const jar=new Map<string,string>();
async function request(path:string,input?:unknown){
 const response=await fetch(origin+path,{...(input?{method:'POST',headers:{'content-type':'application/json',cookie:[...jar.values()].join('; ')},body:JSON.stringify(input)}:{headers:{cookie:[...jar.values()].join('; ')}})});
 for(const entry of response.headers.getSetCookie()){const pair=entry.split(';')[0]!,name=pair.split('=')[0]!;if(entry.includes('Max-Age=0'))jar.delete(name);else jar.set(name,pair);}
 return {response,body:await response.json()};
}
beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'chog-full-api-'));server=gameServer({root,cases:[draft],partners:pool.slice(0,3),allPartners:pool,secure:false});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;},30_000);
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});},30_000);
test('a guest receives three stable starters while player responses omit all session credentials',async()=>{
 await request('/api/cases');const first=(await request('/api/player')).body,second=(await request('/api/player')).body;
 expect(first.starters).toEqual(second.starters);expect(first.starters).toHaveLength(3);expect(first).not.toHaveProperty('sessions');expect(first).not.toHaveProperty('sessionIds');
});
test('read-only guest requests do not create player files',async()=>{
 for(const path of ['/api/cases','/api/player','/api/partners'])await request(path);
 const files=await readdir(join(root,'runs/players')).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;});expect(files).toEqual([]);
});
test('an unrecruited partner cannot be selected through a direct API request',async()=>{
 const result=await request('/api/session',{caseId:draft.public.id,partnerId:4});expect(result.response.status).toBe(400);
});
test('all ten cards are available through HTTP and a submitted result is reconciled into server progress',async()=>{
 let result=await request('/api/session',{caseId:draft.public.id,partnerId:1});expect(result.body.cards).toHaveLength(10);
 result=await request('/api/session/action',{type:'ask',revision:0,tokenId:draft.public.subject.tokenId,card:'PRICE_TALK'});
 expect(result.body.testimony[0].card).toBe('PRICE_TALK');expect(result.body.testimony[0]).not.toHaveProperty('sources');
 result=await request('/api/session/action',{type:'submit',revision:1,answers:draft.private.key.answers});expect(result.body.result).toBeTruthy();
 const player=(await request('/api/player')).body;expect(player.results).toHaveLength(1);expect(player.results[0].kind).toBe('ARCHIVE');expect(player.streak).toBe(0);
 await request('/api/session');expect((await request('/api/player')).body.results).toHaveLength(1);
});
test('locked sessions cannot request a comic before submission',async()=>{
 await request('/api/session',{caseId:draft.public.id,partnerId:1,restart:true});expect((await request('/api/session/comic')).response.status).toBe(403);expect((await request('/api/session/share')).response.status).toBe(403);
});
test('missing chain and live configuration is disclosed without a false pass or live claim',async()=>{
 expect((await request('/api/verify/'+draft.public.id)).body.status).toBe('LOCAL_ONLY');expect((await request('/api/publications')).body.cases).toEqual([]);expect((await request('/api/live')).body.state).toBe('OFFLINE');
 expect((await request('/api/scam-desk?wallet=0x'+'12'.repeat(20))).response.status).toBe(503);
});
test('deleting guest progress removes all of its sessions, including restarted files',async()=>{
 expect((await readdir(join(root,'runs/game-sessions'))).length).toBeGreaterThan(1);
 expect((await request('/api/player/delete',{confirm:'DELETE'})).body.deleted).toBe(true);
 expect(await readdir(join(root,'runs/game-sessions'))).toEqual([]);expect((await request('/api/session')).response.status).toBe(404);expect((await request('/api/player')).body.results).toEqual([]);
});
