import {createDecipheriv,createECDH,createHmac,createPublicKey,randomBytes,verify} from 'node:crypto';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,expect} from 'vitest';
import {encryptPayload,vapidHeader,PushDesk} from '../src/push.mts';

const hkdf=(salt:Buffer,ikm:Buffer,info:Buffer,length:number)=>{const prk=createHmac('sha256',salt).update(ikm).digest();return createHmac('sha256',prk).update(Buffer.concat([info,Buffer.from([1])])).digest().subarray(0,length);};
/** A browser's side of RFC 8291, written independently of the sender. */
function browser(){
 const key=createECDH('prime256v1');key.generateKeys();const auth=randomBytes(16);
 return {subscription:{endpoint:'https://push.example.org/send/'+randomBytes(8).toString('hex'),keys:{p256dh:key.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}},
  decrypt(body:Buffer){
   const salt=body.subarray(0,16),length=body.readUInt8(20),sender=body.subarray(21,21+length),data=body.subarray(21+length);
   const ikm=hkdf(auth,key.computeSecret(sender),Buffer.concat([Buffer.from('WebPush: info\0'),key.getPublicKey(),sender]),32);
   const decipher=createDecipheriv('aes-128-gcm',hkdf(salt,ikm,Buffer.from('Content-Encoding: aes128gcm\0'),16),hkdf(salt,ikm,Buffer.from('Content-Encoding: nonce\0'),12));
   decipher.setAuthTag(data.subarray(-16));const plain=Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]);
   expect(plain.at(-1)).toBe(2);return plain.subarray(0,-1).toString();
  }};
}
test('a browser can decrypt the alert, and only that browser',()=>{
 const one=browser(),two=browser(),body=encryptPayload(one.subscription,Buffer.from('{"title":"New case is open."}'));
 expect(body.readUInt32BE(16)).toBe(4096);expect(one.decrypt(body)).toBe('{"title":"New case is open."}');
 expect(()=>two.decrypt(body)).toThrow();
});
test('the VAPID header is a valid ES256 token for the push service origin',()=>{
 const key=createECDH('prime256v1');key.generateKeys();const keys={publicKey:key.getPublicKey().toString('base64url'),privateKey:key.getPrivateKey().toString('base64url')};
 const header=vapidHeader('https://push.example.org/send/abc',keys,'https://chognoir.example',Date.parse('2026-10-22T00:00:00Z'));
 const [,token,k]=header.match(/^vapid t=([^,]+), k=(.+)$/)!;expect(k).toBe(keys.publicKey);
 const [head,claims,signature]=token!.split('.');const publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:key.getPublicKey().subarray(1,33).toString('base64url'),y:key.getPublicKey().subarray(33).toString('base64url')},format:'jwk'});
 expect(verify('sha256',Buffer.from(head+'.'+claims),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature!,'base64url'))).toBe(true);
 expect(JSON.parse(Buffer.from(claims!,'base64url').toString())).toEqual({aud:'https://push.example.org',exp:Date.parse('2026-10-22T12:00:00Z')/1000,sub:'https://chognoir.example'});
});
test('announcements tell followers of a cast Chog first, and drop expired subscriptions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-push-'));
 try{
  const fan=browser(),follower=browser(),gone=browser(),sent=new Map<string,Buffer>();
  const desk=new PushDesk({root,keyFile:join(root,'vapid.json'),subject:'https://chognoir.example',send:async(endpoint,init)=>{sent.set(endpoint,init.body as Buffer);return {status:endpoint===gone.subscription.endpoint?410:201};}});
  expect((await desk.keys()).publicKey).toBe((await desk.keys()).publicKey);
  await desk.subscribe(fan.subscription,null);await desk.subscribe(follower.subscription,11);await desk.subscribe(gone.subscription,null);
  await expect(desk.subscribe({endpoint:'http://insecure.example/x',keys:fan.subscription.keys},null)).rejects.toThrow();
  expect(await desk.announce({caseNumber:3,title:'The first step',cast:[11,40,77],url:'https://chognoir.example/'})).toEqual({sent:2,expired:1,failed:0});
  expect(JSON.parse(follower.decrypt(sent.get(follower.subscription.endpoint)!)).title).toBe("Your Chog is in today's case.");
  expect(JSON.parse(fan.decrypt(sent.get(fan.subscription.endpoint)!)).title).toBe('New case is open.');
  expect((await readdir(join(root,'runs/push'))).length).toBe(2);
 }finally{await rm(root,{recursive:true,force:true});}
});
