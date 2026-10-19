import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,link,unlink,chmod,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
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
export const privateVaultKeyFile=()=>process.env.CASE_VAULT_KEY_FILE??'/home/ubuntu/chognoir-private/vault.key';
export async function localVault(directory:string,keyFile=join(dirname(directory),'private','vault.key')){
 await mkdir(directory,{recursive:true,mode:0o700});
 const legacy=join(directory,'encryption.key');
 const optional=async(path:string)=>readFile(path).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return null;});
 const old=await optional(legacy),configured=process.env.CASE_VAULT_KEY;
 let key:Buffer|null=await optional(keyFile);
 if(configured){
  if(!/^(0x)?[0-9a-f]{64}$/i.test(configured))throw new Error('VAULT_KEY: Expected a 32-byte hexadecimal key');
  const supplied=Buffer.from(configured.replace(/^0x/i,''),'hex');
  if(key&&!key.equals(supplied)||old&&!old.equals(supplied))throw new Error('VAULT_KEY_CONFLICT: Existing ciphertext belongs to a different master key');
  key=supplied;
 }else if(!key){
  const ciphertexts=await readdir(join(directory,'cases')).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return [];});
  if(!old&&ciphertexts.some(file=>file.endsWith('.json')))throw new Error('VAULT_KEY_MISSING: Existing ciphertext must retain its original master key');
  await mkdir(dirname(keyFile),{recursive:true,mode:0o700});
  const temporary=keyFile+'.'+randomBytes(8).toString('hex')+'.tmp';
  await writeFile(temporary,old??randomBytes(32),{flag:'wx',mode:0o600});
  try{await link(temporary,keyFile);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}finally{await unlink(temporary);}
  key=await readFile(keyFile);
 }
 if(!key||key.length!==32||old&&!old.equals(key))throw new Error('VAULT_KEY_CONFLICT: Refusing to replace the existing encryption key');
 if(await optional(keyFile))await chmod(keyFile,0o600);
 if(old)await unlink(legacy).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
 return new CaseVault(join(directory,'cases'),key);
}
