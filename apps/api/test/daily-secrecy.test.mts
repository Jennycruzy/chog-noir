import {test,expect} from 'vitest';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {gameServer} from '../src/game.mts';
import {draft as original,partner} from '../../../packages/game/test/fixture.mts';

test('daily submission stays private, credits the main streak, and finalizes once after confirmed close',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-daily-secrecy-')),draft=structuredClone(original);
 const day=new Date().toISOString().slice(0,10),now=Math.floor(Date.now()/1000);
 draft.public.id=day+'-main';
 draft.public.publication={kind:'MAIN',day,opensAt:now-100,closesAt:now+100,openTx:'0x'+'12'.repeat(32),closeTx:null,contract:'0x'+'34'.repeat(20),closed:false};
 const pool=[partner,{...partner,tokenId:2,power:'ANALYST' as const},{...partner,tokenId:3,power:'EMPATH' as const}];
 const server=gameServer({root,cases:[draft],partners:pool,allPartners:pool,secure:false});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,jar=new Map<string,string>();
 async function request(path:string,input?:unknown){
  const response=await fetch(origin+path,{headers:{cookie:[...jar.values()].join('; '),...(input?{'content-type':'application/json'}:{})},...(input?{method:'POST',body:JSON.stringify(input)}:{})});
  for(const entry of response.headers.getSetCookie()){const pair=entry.split(';')[0]!;jar.set(pair.split('=')[0]!,pair);}
  return {status:response.status,body:await response.json()};
 }
 try{
  let state=(await request('/api/session',{caseId:draft.public.id,partnerId:partner.tokenId})).body;
  state=(await request('/api/session/action',{revision:state.revision,type:'submit',answers:draft.private.key.answers})).body;
  expect(state.locked).toBe(true);expect(state.result).toBe(null);expect(state.lieCaught).toBe(false);
  const forbidden=new Set(['answer','answerId','correct','lie','proof','key','salt']);
  function inspect(value:unknown){if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){expect(forbidden.has(key),key).toBe(false);inspect(item);}}
  inspect(state);
  for(const sealed of draft.public.ledger.filter(item=>item.sealed))expect(state.ledger.find((item:{id:string})=>item.id===sealed.id)).not.toHaveProperty('text');
  for(const path of ['/api/session/comic','/api/session/share'])expect((await request(path)).status).toBe(403);
  expect((await request('/api/session',{caseId:draft.public.id,partnerId:partner.tokenId,restart:true})).status).toBe(403);
  let player=(await request('/api/player')).body;expect(player.results).toHaveLength(0);expect(player.streak).toBe(1);expect(player.unlocked).toEqual(player.starters);
  const files=await readdir(join(root,'runs/players'));let stored=JSON.parse(await readFile(join(root,'runs/players',files[0]!),'utf8'));expect(stored.pending).toHaveLength(1);
  // An elapsed deadline alone never authorizes reveal: a confirmed close is required.
  draft.public.publication.closesAt=now-1;
  expect((await request('/api/session')).body.result).toBe(null);
  expect((await request('/api/session',{caseId:draft.public.id,partnerId:partner.tokenId,restart:true})).status).toBe(403);
  draft.public.publication.closed=true;draft.public.publication.closeTx='0x'+'56'.repeat(32);
  // Starting practice immediately after reveal must finalize the original pending result first.
  expect((await request('/api/session',{caseId:draft.public.id,partnerId:partner.tokenId,restart:true})).status).toBe(201);
  player=(await request('/api/player')).body;expect(player.results).toHaveLength(1);expect(player.results[0].kind).toBe('MAIN');
  state=(await request('/api/session')).body;expect(state.practice).toBe(true);
  state=(await request('/api/session/action',{revision:state.revision,type:'submit',answers:draft.private.key.answers})).body;expect(state.locked).toBe(false);expect(state.result.questions).toHaveLength(3);expect(state.result.verification.salt).toBe(draft.private.salt);
  player=(await request('/api/player')).body;expect(player.results).toHaveLength(1);expect(player.results[0].kind).toBe('MAIN');expect(player.streak).toBe(1);
  await request('/api/session');expect((await request('/api/player')).body.results).toHaveLength(1);
  stored=JSON.parse(await readFile(join(root,'runs/players',files[0]!),'utf8'));expect(stored.pending).toEqual([]);
 }finally{await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
},60_000);
