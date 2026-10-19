import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {keccak256,toBytes} from 'viem';
import type {CaseDraft} from '../../cases/src/build.mts';
export async function atomicJSON(path:string,value:unknown){
 const temporary=`${path}.${randomBytes(8).toString('hex')}.tmp`;
 await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,path);
}
export class CaseVault {
 constructor(private directory:string,private key:Buffer){if(key.length!==32)throw new Error('VAULT_KEY: Expected 32 bytes');}
 private path(id:string){return join(this.directory,keccak256(toBytes(id))+'.json');}
 async save(draft:CaseDraft){
  await mkdir(this.directory,{recursive:true,mode:0o700});
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);cipher.setAAD(Buffer.from(draft.public.id));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(draft),'utf8'),cipher.final()]);
  await atomicJSON(this.path(draft.public.id),{v:1,id:draft.public.id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:encrypted.toString('hex')});
 }
 async load(id:string):Promise<CaseDraft>{
  const stored=JSON.parse(await readFile(this.path(id),'utf8'));
  if(stored.id!==id||stored.v!==1)throw new Error('VAULT_CASE: Mismatched encrypted case');
  const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(stored.nonce,'hex'));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(stored.tag,'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.ciphertext,'hex')),decipher.final()]).toString('utf8')) as CaseDraft;
 }
}
export async function localVault(directory:string){
 await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,'encryption.key');
 let key:Buffer;
 try{key=await readFile(path);}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  try{await writeFile(path,randomBytes(32),{flag:'wx',mode:0o600});}catch(writeError){if((writeError as NodeJS.ErrnoException).code!=='EEXIST')throw writeError;}
  key=await readFile(path);
 }
 return new CaseVault(join(directory,'cases'),key);
}
