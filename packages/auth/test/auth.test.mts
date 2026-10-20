import {test,expect} from 'vitest';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyMessage} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {WalletAuth,type AuthOptions} from '../src/auth.mts';

const origin='https://chognoir.54-154-121-30.sslip.io';
async function temporary(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'chog-auth-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
const verifier:AuthOptions['verify']=request=>verifyMessage(request);

test('wallet sign-in binds the domain and chain, stores only a token digest, and survives restart',()=>temporary(async root=>{
 const account=privateKeyToAccount(generatePrivateKey()),auth=new WalletAuth({root,origin,verify:verifier});
 const challenge=await auth.issue(account.address);
 expect(challenge.message).toContain('URI: '+origin);expect(challenge.message).toContain('Chain ID: 143');
 const signature=await account.signMessage({message:challenge.message});
 const result=await auth.verify(challenge.nonce,signature);
 const session=await new WalletAuth({root,origin,verify:verifier}).session(result.token);
 expect(session?.address).toBe(account.address);
 const files=await readdir(join(root,'runs/auth/sessions'));expect(files).toEqual([result.session.id+'.json']);
 expect(files[0]).not.toContain(result.token);
 expect(await readFile(join(root,'runs/auth/sessions',files[0]!),'utf8')).not.toContain(result.token);
 expect(auth.cookie(result.token)).toContain('; HttpOnly; SameSite=Lax; Max-Age=43200; Secure');
 await auth.revoke(result.token);await expect(auth.session(result.token)).rejects.toMatchObject({code:'AUTH_SESSION_INVALID'});
}));

test('concurrent verification consumes a nonce once across independent service instances',()=>temporary(async root=>{
 const account=privateKeyToAccount(generatePrivateKey());
 const first=new WalletAuth({root,origin,verify:verifier}),second=new WalletAuth({root,origin,verify:verifier});
 const challenge=await first.issue(account.address),signature=await account.signMessage({message:challenge.message});
 const results=await Promise.allSettled([first.verify(challenge.nonce,signature),second.verify(challenge.nonce,signature)]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const rejected=results.find(result=>result.status==='rejected');
 expect(rejected?.status==='rejected'&&rejected.reason).toMatchObject({code:'AUTH_NONCE_USED'});
 expect(await readdir(join(root,'runs/auth/sessions'))).toHaveLength(1);
}));

test('another wallet cannot answer the challenge and a failed signature grants no session',()=>temporary(async root=>{
 const owner=privateKeyToAccount(generatePrivateKey()),other=privateKeyToAccount(generatePrivateKey());
 const auth=new WalletAuth({root,origin,verify:verifier}),challenge=await auth.issue(owner.address);
 await expect(auth.verify(challenge.nonce,await other.signMessage({message:challenge.message}))).rejects.toMatchObject({code:'AUTH_BAD_SIGNATURE'});
 await expect(auth.verify(challenge.nonce,await owner.signMessage({message:challenge.message}))).rejects.toMatchObject({code:'AUTH_NONCE_USED'});
 await expect(readdir(join(root,'runs/auth/sessions'))).rejects.toMatchObject({code:'ENOENT'});
}));

test('nonces expire at five minutes and sessions at twelve hours',()=>temporary(async root=>{
 let now=Date.parse('2026-10-20T12:00:00Z');const account=privateKeyToAccount(generatePrivateKey());
 const auth=new WalletAuth({root,origin,verify:verifier,now:()=>now});
 const expired=await auth.issue(account.address),signature=await account.signMessage({message:expired.message});
 now+=5*60_000;await expect(auth.verify(expired.nonce,signature)).rejects.toMatchObject({code:'AUTH_NONCE_USED'});
 const fresh=await auth.issue(account.address),result=await auth.verify(fresh.nonce,await account.signMessage({message:fresh.message}));
 now+=12*60*60_000;await expect(auth.session(result.token)).rejects.toMatchObject({code:'AUTH_SESSION_EXPIRED'});
}));

test('a changed origin or stored message fails closed instead of reusing the challenge',()=>temporary(async root=>{
 const account=privateKeyToAccount(generatePrivateKey()),auth=new WalletAuth({root,origin,verify:verifier});
 const challenge=await auth.issue(account.address),signature=await account.signMessage({message:challenge.message});
 const other=new WalletAuth({root,origin:'https://other.example',verify:verifier});
 await expect(other.verify(challenge.nonce,signature)).rejects.toMatchObject({code:'AUTH_STORAGE_INVALID'});
 const path=join(root,'runs/auth/nonces',challenge.nonce+'.json'),record=JSON.parse(await readFile(path,'utf8'));
 await writeFile(path,JSON.stringify({...record,message:record.message+'\nDifferent permission'}));
 await expect(auth.verify(challenge.nonce,signature)).rejects.toMatchObject({code:'AUTH_STORAGE_INVALID'});
}));

test('verification outages and malformed identifiers never grant a session',()=>temporary(async root=>{
 const account=privateKeyToAccount(generatePrivateKey());
 const auth=new WalletAuth({root,origin,verify:async()=>{throw new Error('RPC unavailable');}});
 const challenge=await auth.issue(account.address);
 await expect(auth.verify(challenge.nonce,await account.signMessage({message:challenge.message}))).rejects.toMatchObject({code:'AUTH_VERIFY_UNAVAILABLE',status:503});
 await expect(auth.verify('../escape','0x00')).rejects.toMatchObject({code:'AUTH_NONCE_USED'});
 await expect(auth.session('../escape')).rejects.toMatchObject({code:'AUTH_SESSION_INVALID'});
 expect(await auth.session(undefined)).toBeNull();
 await expect(readdir(join(root,'runs/auth/sessions'))).rejects.toMatchObject({code:'ENOENT'});
 expect(()=>new WalletAuth({root,origin:'http://public.example',verify:verifier})).toThrow('secure sign-in origin');
}));
