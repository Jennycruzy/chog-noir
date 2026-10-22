import {mkdir,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {getAddress} from 'viem';
import {atomicJSON} from '../../publishing/src/vault.mts';

/** Wallets that asked to be left out. New cases never use an event or witness that involves one of them. */
export class OptOuts {
 constructor(private readonly root:string,private readonly now=()=>Date.now()){}
 private get directory(){return join(this.root,'runs/optout');}
 async record(address:string){
  const wallet=getAddress(address).toLowerCase(),path=join(this.directory,wallet+'.json');
  const existing=await readFile(path,'utf8').then(text=>JSON.parse(text) as {recordedAt:string}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
  if(existing)return existing;
  await mkdir(this.directory,{recursive:true,mode:0o700});const value={address:wallet,recordedAt:new Date(this.now()).toISOString()};await atomicJSON(path,value);return value;
 }
 async wallets(){
  const files=await readdir(this.directory).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return [] as string[];throw error;});
  return new Set(files.filter(file=>/^0x[a-f0-9]{40}\.json$/.test(file)).map(file=>file.slice(0,-5)));
 }
}
