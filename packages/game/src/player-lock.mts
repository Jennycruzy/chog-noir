import {mkdir,open} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
export class PlayerBusy extends Error {}
/** Exclusive lock on a file; the kernel releases it when the holder exits, so a crashed process never blocks the next one. */
export async function withFileLock<T,>(path:string,action:()=>Promise<T>,wait=5):Promise<T>{
 const handle=await open(path,'a',0o600);
 try{
  // The child locks the parent's open file description; closing our handle releases it.
  await new Promise<void>((resolve,reject)=>{const child=spawn('flock',['-x','-w',String(wait),'3'],{stdio:['ignore','ignore','ignore',handle.fd]});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(code===1?new PlayerBusy('Player progress is busy'):new Error('PLAYER_LOCK_FAILED')));});
  return await action();
 }finally{await handle.close();}
}
export async function withPlayerLock<T,>(root:string,id:string,action:()=>Promise<T>,wait=5):Promise<T>{
 if(!/^[a-f0-9]{64}$/.test(id))throw new Error('PLAYER_LOCK_ID');
 const directory=join(root,'runs/player-locks');await mkdir(directory,{recursive:true,mode:0o700});
 return withFileLock(join(directory,id+'.lock'),action,wait);
}
