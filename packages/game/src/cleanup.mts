import {readdir,lstat,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {PlayerBusy,withPlayerLock} from './player-lock.mts';
export async function cleanupGame(root:string,now=Date.now()){
 const report={renderedRemoved:0,playersRemoved:0,skipped:0,errors:0};
 async function files(directory:string){try{return await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}}
 const rendered=join(root,'runs/rendered');
 for(const file of (await files(rendered)).filter(file=>/^[a-f0-9]{64}\.png$/.test(file))){
  const path=join(rendered,file),info=await lstat(path);if(info.isFile()&&info.mtimeMs<now-7*86400000){await unlink(path);report.renderedRemoved++;}
 }
 const players=join(root,'runs/players');
 for(const file of (await files(players)).filter(file=>/^[a-f0-9]{64}\.json$/.test(file))){
  try{await withPlayerLock(root,file.slice(0,-5),async()=>{
   const path=join(players,file),info=await lstat(path);if(!info.isFile()||info.mtimeMs>=now-30*86400000)return;
   const player=JSON.parse(await readFile(path,'utf8'));
   if(!Array.isArray(player.results)||player.results.length||(player.pending?.length??0)>0)return;
   await unlink(path);report.playersRemoved++;
  },0);}catch(error){if(error instanceof PlayerBusy)report.skipped++;else if((error as NodeJS.ErrnoException).code!=='ENOENT')report.errors++;}
 }
 return report;
}
