import {readdir,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
/** Removes spent sign-in material: nonces older than an hour (they expire after five minutes) and expired wallet sessions. */
export async function cleanupGame(root:string,now=Date.now()){
 const report={noncesRemoved:0,sessionsRemoved:0,errors:0};
 async function files(directory:string){try{return await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}}
 const remove=async(path:string,key:'noncesRemoved'|'sessionsRemoved')=>{try{await unlink(path);report[key]++;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')report.errors++;}};
 const nonces=join(root,'runs/auth/nonces');
 for(const file of (await files(nonces)).filter(name=>/^[a-f0-9]{32}\.json$/.test(name))){
  try{const value=JSON.parse(await readFile(join(nonces,file),'utf8'));if(!Number.isSafeInteger(value.expiresAt)||value.expiresAt<now-3600_000)await remove(join(nonces,file),'noncesRemoved');}catch{report.errors++;}
 }
 const sessions=join(root,'runs/auth/sessions');
 for(const file of (await files(sessions)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){
  try{const value=JSON.parse(await readFile(join(sessions,file),'utf8'));if(!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now)await remove(join(sessions,file),'sessionsRemoved');}catch{report.errors++;}
 }
 return report;
}
