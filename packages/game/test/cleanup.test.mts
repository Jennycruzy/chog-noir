import {test,expect} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cleanupGame} from '../src/cleanup.mts';
test('cleanup removes spent nonces and expired sessions and keeps live ones',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-cleanup-')),now=Date.parse('2026-10-22T12:00:00Z'),nonces=join(root,'runs/auth/nonces'),sessions=join(root,'runs/auth/sessions');
 await mkdir(nonces,{recursive:true});await mkdir(sessions,{recursive:true});
 try{
  await writeFile(join(nonces,'1'.repeat(32)+'.json'),JSON.stringify({expiresAt:now-2*3600_000}));await writeFile(join(nonces,'2'.repeat(32)+'.json'),JSON.stringify({expiresAt:now+60_000}));
  await writeFile(join(sessions,'1'.repeat(64)+'.json'),JSON.stringify({expiresAt:now-1}));await writeFile(join(sessions,'2'.repeat(64)+'.json'),JSON.stringify({expiresAt:now+3600_000}));
  expect(await cleanupGame(root,now)).toEqual({noncesRemoved:1,sessionsRemoved:1,errors:0});
  expect(await readdir(nonces)).toEqual(['2'.repeat(32)+'.json']);expect(await readdir(sessions)).toEqual(['2'.repeat(64)+'.json']);
 }finally{await rm(root,{recursive:true,force:true});}
});
