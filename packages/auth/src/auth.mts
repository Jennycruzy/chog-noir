import {randomBytes,createHash} from 'node:crypto';
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {getAddress,type Address,type Hex} from 'viem';
import {withPlayerLock} from '../../game/src/player-lock.mts';

const NONCE_LIFETIME=5*60_000,SESSION_LIFETIME=12*60*60_000;
export class AuthError extends Error {
 constructor(public readonly code:string,message:string,public readonly status=401){super(message);}
}
interface Nonce {v:1;nonce:string;address:Address;origin:string;message:string;issuedAt:number;expiresAt:number;used:boolean}
export interface WalletSession {v:1;id:string;address:Address;origin:string;issuedAt:number;expiresAt:number}
export interface AuthOptions {
 root:string;origin:string;
 verify:(request:{address:Address;message:string;signature:Hex})=>Promise<boolean>;
 now?:()=>number;
}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const validTime=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
async function atomicJSON(path:string,value:unknown){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const temporary=path+'.'+randomBytes(8).toString('hex')+'.tmp';
 const handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
 await rename(temporary,path);
 const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
}
async function storedJSON(path:string):Promise<unknown|undefined>{
 try{return JSON.parse(await readFile(path,'utf8'));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw new AuthError('AUTH_STORAGE_INVALID','Sign-in storage could not be read.',503);}
}
function signInMessage(origin:URL,address:Address,nonce:string,issuedAt:number,expiresAt:number){
 return `${origin.host} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Chog Noir. This does not authorize a transaction.\n\nURI: ${origin.origin}\nVersion: 1\nChain ID: 143\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
}
export class WalletAuth {
 private readonly origin:URL;
 private readonly now:()=>number;
 constructor(private readonly options:AuthOptions){
  this.origin=new URL(options.origin);this.now=options.now??Date.now;
  const loopback=['localhost','127.0.0.1','[::1]'].includes(this.origin.hostname);
  if((this.origin.protocol!=='https:'&&!(this.origin.protocol==='http:'&&loopback))||this.origin.username||this.origin.password||this.origin.pathname!=='/'||this.origin.search||this.origin.hash)throw new AuthError('AUTH_ORIGIN_INVALID','Configure a secure sign-in origin.',500);
 }
 private clock(){const now=this.now();if(!validTime(now))throw new AuthError('AUTH_CLOCK_INVALID','Sign-in time is unavailable.',503);return now;}
 private noncePath(nonce:string){return join(this.options.root,'runs/auth/nonces',nonce+'.json');}
 private sessionPath(id:string){return join(this.options.root,'runs/auth/sessions',id+'.json');}
 async issue(address:string):Promise<{nonce:string;message:string;expiresAt:number}>{
  let account:Address;try{account=getAddress(address);}catch{throw new AuthError('AUTH_ADDRESS_INVALID','Connect a valid wallet.',400);}
  const issuedAt=this.clock(),expiresAt=issuedAt+NONCE_LIFETIME,nonce=randomBytes(16).toString('hex');
  const record:Nonce={v:1,nonce,address:account,origin:this.origin.origin,issuedAt,expiresAt,used:false,message:signInMessage(this.origin,account,nonce,issuedAt,expiresAt)};
  const path=this.noncePath(nonce);await mkdir(dirname(path),{recursive:true,mode:0o700});
  const handle=await open(path,'wx',0o600);try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
  return {nonce,message:record.message,expiresAt};
 }
 async verify(nonce:string,signature:string):Promise<{token:string;session:WalletSession}>{
  if(!/^[a-f0-9]{32}$/.test(nonce))throw new AuthError('AUTH_NONCE_USED','Sign a fresh sign-in message.');
  if(!/^0x(?:[a-f0-9]{2})+$/i.test(signature)||signature.length>16_386)throw new AuthError('AUTH_BAD_SIGNATURE',"That signature didn't check out. Try again.");
  const record=await withPlayerLock(this.options.root,digest('auth-nonce:'+nonce),async()=>{
   const value=await storedJSON(this.noncePath(nonce)) as Nonce|undefined;
   if(!value)throw new AuthError('AUTH_NONCE_USED','Sign a fresh sign-in message.');
   let address:Address;try{address=getAddress(value.address);}catch{throw new AuthError('AUTH_STORAGE_INVALID','Sign-in storage could not be read.',503);}
   if(value.v!==1||value.nonce!==nonce||value.origin!==this.origin.origin||typeof value.used!=='boolean'||!validTime(value.issuedAt)||!validTime(value.expiresAt)||value.expiresAt!==value.issuedAt+NONCE_LIFETIME||value.message!==signInMessage(this.origin,address,nonce,value.issuedAt,value.expiresAt))throw new AuthError('AUTH_STORAGE_INVALID','Sign-in storage could not be read.',503);
   const now=this.clock();if(value.used||now>=value.expiresAt||now<value.issuedAt)throw new AuthError('AUTH_NONCE_USED','Sign a fresh sign-in message.');
   // Consume before verification so concurrent requests cannot create two sessions.
   await atomicJSON(this.noncePath(nonce),{...value,used:true});return value;
  });
  let verified:boolean;
  try{verified=await this.options.verify({address:record.address,message:record.message,signature:signature as Hex});}
  catch{throw new AuthError('AUTH_VERIFY_UNAVAILABLE','Wallet verification is unavailable. Try again.',503);}
  if(verified!==true)throw new AuthError('AUTH_BAD_SIGNATURE',"That signature didn't check out. Try again.");
  const token=randomBytes(32).toString('hex'),issuedAt=this.clock();
  const session:WalletSession={v:1,id:digest(token),address:record.address,origin:this.origin.origin,issuedAt,expiresAt:issuedAt+SESSION_LIFETIME};
  await atomicJSON(this.sessionPath(session.id),session);return {token,session};
 }
 async session(token:string|undefined):Promise<WalletSession|null>{
  if(token===undefined)return null;
  if(!/^[a-f0-9]{64}$/.test(token))throw new AuthError('AUTH_SESSION_INVALID','Connect your wallet again.');
  const id=digest(token),value=await storedJSON(this.sessionPath(id)) as WalletSession|undefined;
  if(!value)throw new AuthError('AUTH_SESSION_INVALID','Connect your wallet again.');
  let address:Address;try{address=getAddress(value.address);}catch{throw new AuthError('AUTH_STORAGE_INVALID','Sign-in storage could not be read.',503);}
  if(value.v!==1||value.id!==id||value.origin!==this.origin.origin||address!==value.address||!validTime(value.issuedAt)||!validTime(value.expiresAt)||value.expiresAt!==value.issuedAt+SESSION_LIFETIME)throw new AuthError('AUTH_STORAGE_INVALID','Sign-in storage could not be read.',503);
  const now=this.clock();if(now>=value.expiresAt||now<value.issuedAt)throw new AuthError('AUTH_SESSION_EXPIRED','Connect your wallet again.');
  return value;
 }
 cookie(token:string){
  if(!/^[a-f0-9]{64}$/.test(token))throw new AuthError('AUTH_SESSION_INVALID','Connect your wallet again.');
  return `chog_noir_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME/1000}${this.origin.protocol==='https:'?'; Secure':''}`;
 }
 async revoke(token:string){
  if(!/^[a-f0-9]{64}$/.test(token))throw new AuthError('AUTH_SESSION_INVALID','Connect your wallet again.');
  await unlink(this.sessionPath(digest(token))).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
 }
}
