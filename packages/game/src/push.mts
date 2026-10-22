import {createCipheriv,createECDH,createHash,createHmac,createPrivateKey,randomBytes,sign} from 'node:crypto';
import {mkdir,readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicJSON} from '../../publishing/src/vault.mts';

export class PushError extends Error {constructor(public readonly code:string,message:string,public readonly status=400){super(message);}}
export interface PushSubscription {endpoint:string;keys:{p256dh:string;auth:string}}
interface Stored {v:1;endpoint:string;keys:{p256dh:string;auth:string};tokens:number[];createdAt:string}
const b64=(bytes:Buffer)=>bytes.toString('base64url');
const hkdf=(salt:Buffer,ikm:Buffer,info:Buffer,length:number)=>{const prk=createHmac('sha256',salt).update(ikm).digest();return createHmac('sha256',prk).update(Buffer.concat([info,Buffer.from([1])])).digest().subarray(0,length);};

/** RFC 8291 aes128gcm payload for one subscription, from a fresh sender key and salt. */
const freshKey=()=>{const key=createECDH('prime256v1');key.generateKeys();return key;};
export function encryptPayload(subscription:PushSubscription,payload:Buffer,sender=freshKey(),salt=randomBytes(16)){
 const client=Buffer.from(subscription.keys.p256dh,'base64url'),secret=Buffer.from(subscription.keys.auth,'base64url');
 if(client.length!==65||client[0]!==4||secret.length!==16)throw new PushError('PUSH_SUBSCRIPTION_INVALID','This browser subscription cannot receive alerts.');
 const senderPublic=sender.getPublicKey(),shared=sender.computeSecret(client);
 const ikm=hkdf(secret,shared,Buffer.concat([Buffer.from('WebPush: info\0'),client,senderPublic]),32);
 const key=hkdf(salt,ikm,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdf(salt,ikm,Buffer.from('Content-Encoding: nonce\0'),12);
 const cipher=createCipheriv('aes-128-gcm',key,nonce),body=Buffer.concat([cipher.update(Buffer.concat([payload,Buffer.from([2])])),cipher.final(),cipher.getAuthTag()]);
 const header=Buffer.alloc(21);salt.copy(header,0);header.writeUInt32BE(4096,16);header.writeUInt8(senderPublic.length,20);
 return Buffer.concat([header,senderPublic,body]);
}
/** RFC 8292 VAPID authorization for one push service origin. */
export function vapidHeader(endpoint:string,keys:{publicKey:string;privateKey:string},subject:string,now=Date.now()){
 const audience=new URL(endpoint).origin,encode=(value:object)=>b64(Buffer.from(JSON.stringify(value)));
 const unsigned=encode({typ:'JWT',alg:'ES256'})+'.'+encode({aud:audience,exp:Math.floor(now/1000)+12*3600,sub:subject});
 const publicKey=Buffer.from(keys.publicKey,'base64url'),privateKey=createPrivateKey({key:{kty:'EC',crv:'P-256',d:keys.privateKey,x:b64(publicKey.subarray(1,33)),y:b64(publicKey.subarray(33))},format:'jwk'});
 const signature=sign('sha256',Buffer.from(unsigned),{key:privateKey,dsaEncoding:'ieee-p1363'});
 return `vapid t=${unsigned}.${b64(signature)}, k=${keys.publicKey}`;
}

/** Opt-in alerts, stored per browser subscription with the Chogs it follows. Nothing is sent without a subscription. */
export class PushDesk {
 constructor(private readonly options:{root:string;keyFile:string;subject:string;send?:(endpoint:string,init:RequestInit)=>Promise<{status:number}>}){}
 private get directory(){return join(this.options.root,'runs/push');}
 /** The VAPID key pair lives in private storage; it is created once and then always reused. */
 async keys():Promise<{publicKey:string;privateKey:string}>{
  try{return JSON.parse(await readFile(this.options.keyFile,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const ecdh=createECDH('prime256v1');ecdh.generateKeys();const keys={publicKey:b64(ecdh.getPublicKey()),privateKey:b64(ecdh.getPrivateKey())};
  try{await writeFile(this.options.keyFile,JSON.stringify(keys),{mode:0o600,flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  return JSON.parse(await readFile(this.options.keyFile,'utf8'));
 }
 private path(endpoint:string){return join(this.directory,createHash('sha256').update(endpoint).digest('hex')+'.json');}
 async subscribe(subscription:PushSubscription,tokenId:number|null){
  let endpoint:URL;try{endpoint=new URL(subscription.endpoint);}catch{throw new PushError('PUSH_SUBSCRIPTION_INVALID','This browser subscription cannot receive alerts.');}
  if(endpoint.protocol!=='https:'||subscription.endpoint.length>1000)throw new PushError('PUSH_SUBSCRIPTION_INVALID','This browser subscription cannot receive alerts.');
  encryptPayload(subscription,Buffer.from('check'));
  await mkdir(this.directory,{recursive:true,mode:0o700});
  const saved=await readFile(this.path(subscription.endpoint),'utf8').then(text=>JSON.parse(text) as Stored).catch(()=>null);
  const tokens=[...new Set([...(saved?.tokens??[]),...(tokenId===null?[]:[tokenId])])].sort((a,b)=>a-b);
  const value:Stored={v:1,endpoint:subscription.endpoint,keys:subscription.keys,tokens,createdAt:saved?.createdAt??new Date().toISOString()};
  await atomicJSON(this.path(subscription.endpoint),value);return {tokens};
 }
 async unsubscribe(endpoint:string){await unlink(this.path(endpoint)).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
 private async all(){
  const files=await readdir(this.directory).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return [] as string[];throw error;});
  const rows:Stored[]=[];for(const file of files.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)))rows.push(JSON.parse(await readFile(join(this.directory,file),'utf8')));return rows;
 }
 /** "New case is open" to every subscriber; "Your Chog is in today's case" to those following a Chog in the cast. */
 async announce(input:{caseNumber:number;title:string;cast:number[];url:string}){
  const keys=await this.keys(),send=this.options.send??((endpoint,init)=>fetch(endpoint,{...init,signal:AbortSignal.timeout(15_000)}));
  const report={sent:0,expired:0,failed:0};
  for(const row of await this.all()){
   const own=row.tokens.find(id=>input.cast.includes(id));
   const message=own!==undefined?{title:"Your Chog is in today's case.",body:`Case #${input.caseNumber} · ${input.title}`,url:input.url}:{title:'New case is open.',body:`Case #${input.caseNumber} · ${input.title}`,url:input.url};
   try{
    const response=await send(row.endpoint,{method:'POST',headers:{'content-encoding':'aes128gcm','content-type':'application/octet-stream',ttl:'43200',urgency:'normal',authorization:vapidHeader(row.endpoint,keys,this.options.subject)},body:encryptPayload(row,Buffer.from(JSON.stringify(message)))});
    if(response.status===404||response.status===410){await this.unsubscribe(row.endpoint);report.expired++;}else if(response.status>=200&&response.status<300)report.sent++;else report.failed++;
   }catch{report.failed++;}
  }
  return report;
 }
}
