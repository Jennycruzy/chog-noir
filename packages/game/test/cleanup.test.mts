import {test,expect} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,utimes,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cleanupGame} from '../src/cleanup.mts';
import {withPlayerLock} from '../src/player-lock.mts';
test('cleanup removes expired renders and old empty guests while preserving results, pending cases and recent guests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-cleanup-')),now=Date.now(),players=join(root,'runs/players'),rendered=join(root,'runs/rendered');await mkdir(players,{recursive:true});await mkdir(rendered,{recursive:true});
 async function save(path:string,value:unknown,days:number){await writeFile(path,JSON.stringify(value));const at=new Date(now-days*86400000);await utimes(path,at,at);}
 try{
  await save(join(players,'1'.repeat(64)+'.json'),{results:[]},31);await save(join(players,'2'.repeat(64)+'.json'),{results:[{grade:'A'}]},31);await save(join(players,'3'.repeat(64)+'.json'),{results:[],pending:[{caseId:'waiting'}]},31);await save(join(players,'4'.repeat(64)+'.json'),{results:[]},1);
  await save(join(rendered,'1'.repeat(64)+'.png'),{},8);await save(join(rendered,'2'.repeat(64)+'.png'),{},1);
  expect(await cleanupGame(root,now)).toEqual({renderedRemoved:1,playersRemoved:1,skipped:0,errors:0});expect(await readdir(players)).toHaveLength(3);expect(await readdir(rendered)).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true});}
},60_000);
test('an active player lock survives the flock child exit and cleanup skips that guest',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-player-lock-')),id='1'.repeat(64),directory=join(root,'runs/players');await mkdir(directory,{recursive:true});
 const path=join(directory,id+'.json');await writeFile(path,JSON.stringify({results:[]}));await utimes(path,new Date(0),new Date(0));
 try{await withPlayerLock(root,id,async()=>{const report=await cleanupGame(root);expect(report.skipped).toBe(1);expect(report.playersRemoved).toBe(0);});expect((await cleanupGame(root)).playersRemoved).toBe(1);}
 finally{await rm(root,{recursive:true,force:true});}
},60_000);
