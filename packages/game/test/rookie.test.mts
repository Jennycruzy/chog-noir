import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {test,expect} from 'vitest';
import {RookieDesk,type RookieCase} from '../src/rookie.mts';
import type {Metadata} from '../../cases/src/build.mts';
const rows=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')).tokens as {tokenId:number;metadata:Metadata}[];
const metadata=new Map(rows.map(row=>[row.tokenId,row.metadata]));
const replay=JSON.parse(readFileSync(new URL('./fixtures/rookie-case.json',import.meta.url),'utf8')) as {id:string;occurredAt:string;cast:{tokenId:number}[]};
const day=replay.occurredAt.slice(0,10),opensAt=Date.parse(day)+20*60_000;
const current:RookieCase={id:replay.id,day,opensAt,closesAt:opensAt+86400000,salt:'0x'+createHash('sha256').update('rookie-session-tests').digest('hex'),cast:replay.cast.map(row=>row.tokenId)};
const ip='192.0.2.80';
type State={steps:string[]};
const create=()=>({steps:[]} as State);
async function protectedSnapshot(root:string){
 const result:Record<string,string>={};
 async function visit(path:string){for(const entry of await readdir(join(root,'runs',path),{withFileTypes:true})){const key=path+'/'+entry.name;if(entry.isDirectory())await visit(key);else result[key]=await readFile(join(root,'runs',key),'utf8');}}
 for(const category of ['career','stats','chain','push','precinct'])await visit(category);
 return result;
}
async function sandbox(action:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'chog-rookie-'));try{await action(root);}finally{await rm(root,{recursive:true,force:true});}}
function nextCase():RookieCase{return {...current,id:current.id+'-next',day:new Date(current.closesAt).toISOString().slice(0,10),opensAt:current.closesAt,closesAt:current.closesAt+86400000,salt:'0x'+createHash('sha256').update(current.salt).digest('hex')};}
test('real badge metadata, no cast badge, isolated state and restart-safe resume',async()=>sandbox(async root=>{
 const options={root,metadata,now:()=>opensAt+60_000},desk=new RookieDesk<State>(options);
 const started=await desk.start(current,{ip,create}),badge=started.session.badge;
 expect(current.cast).not.toContain(badge.tokenId);expect(badge.name).toBe(metadata.get(badge.tokenId)?.name);
 expect(badge.questions).toBe(badge.skill==='EMPATH'?8:6);expect(badge.label).toContain('nothing you do here is kept');
 expect(badge).not.toHaveProperty('owner');expect(badge).not.toHaveProperty('side');
 expect(desk.cookie(started.token)).toContain('HttpOnly; SameSite=Lax');expect(desk.cookie(started.token)).toContain('Secure');
 const pressed=await desk.action(current,started.token,0,state=>({state:{steps:[...state.steps,'press']},done:false}));
 expect(pressed.revision).toBe(1);
 const resumed=await new RookieDesk<State>(options).start(current,{browserToken:started.token,ip,create});
 expect(resumed.resumed).toBe(true);expect(resumed.session).toEqual(pressed);expect(await desk.count(current)).toBe(1);
 const stored=await readFile(join(root,'runs/rookie/desk.json'),'utf8');expect(stored).not.toContain(started.token);expect(stored).not.toContain(ip);
}));
test('only one concurrent action uses a revision and completed cases cannot act again',async()=>sandbox(async root=>{
 const desk=new RookieDesk<State>({root,metadata,now:()=>opensAt+60_000}),{token}=await desk.start(current,{ip,create});
 const act=()=>desk.action(current,token,0,()=>({state:{steps:['present']},done:false}));
 const results=await Promise.allSettled([act(),act()]);expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
 await desk.action(current,token,1,state=>({state:{steps:[...state.steps,'solve']},done:true}));
 await expect(desk.action(current,token,2,state=>({state,done:true}))).rejects.toMatchObject({code:'ROOKIE_DONE_TODAY'});
 expect((await desk.start(current,{browserToken:token,ip,create})).session.done).toBe(true);
}));
test('the twenty-per-network UTC quota survives restarts, address formats and case changes',async()=>sandbox(async root=>{
 let now=current.closesAt-10*60_000;const options={root,metadata,now:()=>now};
 for(let i=0;i<20;i++)await new RookieDesk<State>(options).start(current,{ip,create});
 await expect(new RookieDesk<State>(options).start(current,{ip:'::ffff:192.0.2.80',create})).rejects.toMatchObject({code:'ROOKIE_LIMIT'});
 const next=nextCase();now=next.opensAt;
 await expect(new RookieDesk<State>(options).start(next,{ip,create})).rejects.toMatchObject({code:'ROOKIE_LIMIT'});
}));
test('a browser daily quota survives case rollover while old game state is discarded',async()=>sandbox(async root=>{
 let now=current.closesAt-10*60_000;const desk=new RookieDesk<State>({root,metadata,now:()=>now});
 const {token}=await desk.start(current,{ip,create});
 await desk.action(current,token,0,()=>({state:{steps:['private session marker']},done:false}));
 now=current.closesAt;expect(await desk.expire()).toBe(true);
 const stored=await readFile(join(root,'runs/rookie/desk.json'),'utf8');expect(stored).not.toContain('private session marker');
 await expect(desk.start(nextCase(),{browserToken:token,ip,create})).rejects.toMatchObject({code:'ROOKIE_DONE_TODAY'});
 now+=86400000;expect(await desk.expire()).toBe(true);
 await expect(readFile(join(root,'runs/rookie/desk.json'))).rejects.toMatchObject({code:'ENOENT'});
 const next=nextCase(),later={...next,id:next.id+'-later',day:new Date(next.closesAt).toISOString().slice(0,10),opensAt:next.closesAt,closesAt:next.closesAt+86400000};
 const fresh=await desk.start(later,{browserToken:token,ip,create});expect(fresh.resumed).toBe(false);expect(fresh.session.state.steps).toEqual([]);
}));
test('session actions never touch holder careers, aggregate stats, chain records or alerts',async()=>sandbox(async root=>{
 const protectedPaths=['career/1.json','stats/today.json','chain/transactions/protected.json','push/subscriptions.json','precinct/tiles.json'];
 for(const path of protectedPaths){const parent=join(root,'runs',path.slice(0,path.lastIndexOf('/')));await mkdir(parent,{recursive:true});await writeFile(join(root,'runs',path),'untouched');}
 const before=await protectedSnapshot(root);
 const desk=new RookieDesk<State>({root,metadata,now:()=>opensAt+60_000}),{token}=await desk.start(current,{ip,create});
 let revision=0;for(const step of ['press','present','solve'])await desk.action(current,token,revision++,state=>({state:{steps:[...state.steps,step]},done:step==='solve'}));
 for(const path of protectedPaths)expect(await readFile(join(root,'runs',path),'utf8')).toBe('untouched');
 expect(await protectedSnapshot(root)).toEqual(before);
 expect((await readdir(join(root,'runs'))).sort()).toEqual(['career','chain','player-locks','precinct','push','rookie','stats']);
}));
