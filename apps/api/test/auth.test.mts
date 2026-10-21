import {readFileSync} from 'node:fs';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {AddressInfo} from 'node:net';
import {randomBytes} from 'node:crypto';
import {test,expect} from 'vitest';
import {verifyMessage} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {WalletAuth} from '../../../packages/auth/src/auth.mts';
import {HolderDirectory,ownerDirectory,type OwnerSnapshot} from '../../../packages/auth/src/holders.mts';
import {DetectiveRoster,type MetadataRecord} from '../../../packages/auth/src/roster.mts';
import {CareerStore} from '../../../packages/career/src/store.mts';
import {holderRoutes} from '../src/auth.mts';
import {bureauServer} from '../src/bureau.mts';
const snapshot=JSON.parse(readFileSync(new URL('../../../packages/auth/test/fixtures/owners.json',import.meta.url),'utf8')).snapshot as OwnerSnapshot;
const rows=JSON.parse(readFileSync(new URL('../../../packages/traits/test/fixtures/detectives.json',import.meta.url),'utf8')).tokens as {tokenId:number;metadata:MetadataRecord['metadata'];source:{uri:string;fetchedAt:string}}[];
const metadata=new Map(rows.map(row=>[row.tokenId,{metadata:row.metadata,uri:row.source.uri,fetchedAt:row.source.fetchedAt}]));
async function harness(action:(ctx:{root:string;origin:string;post:(path:string,value:unknown,origin?:string)=>Promise<Response>;setNow:(value:number)=>void})=>Promise<void>,acceptContract=false){
 const root=await mkdtemp(join(tmpdir(),'chog-wallet-http-'));let now=snapshot.indexedAt+5000;
 let route:ReturnType<typeof holderRoutes>;
 const server=bureauServer((request,response)=>route(request,response));
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 const owners=ownerDirectory(snapshot),holders=new HolderDirectory({snapshot:async()=>snapshot,now:()=>now,ownerOf:async id=>owners.get(id)!.owner});
 const auth=new WalletAuth({root,origin,now:()=>now,verify:request=>acceptContract?Promise.resolve(true):verifyMessage(request)});
 const roster=new DetectiveRoster({holders,career:new CareerStore(root),metadata,now:()=>now});
 route=holderRoutes({origin,auth,roster,now:()=>now});
 const post=(path:string,value:unknown,from=origin)=>fetch(origin+path,{method:'POST',headers:{origin:from,'content-type':'application/json'},body:JSON.stringify(value)});
 try{await action({root,origin,post,setNow:value=>{now=value;}});}finally{await new Promise<void>((done,reject)=>{server.close(error=>error?reject(error):done());server.closeAllConnections();});await rm(root,{recursive:true,force:true});}
}
test('HTTP sign-in verifies a real EOA signature and returns its secret only in an HttpOnly cookie',async()=>harness(async({origin,post})=>{
 const account=privateKeyToAccount(generatePrivateKey());
 expect((await fetch(origin+'/me/chogs')).status).toBe(401);
 expect((await fetch(origin+'/me/chogs',{headers:{cookie:'chog_noir_rookie='+randomBytes(32).toString('hex')}})).status).toBe(401);
 const challenge=await (await post('/auth/nonce',{address:account.address})).json();
 expect(challenge.message).toContain('Chain ID: 143');
 const signature=await account.signMessage({message:challenge.message});
 const response=await post('/auth/verify',{nonce:challenge.nonce,signature}),body=await response.json();
 expect(response.status).toBe(200);expect(body.authenticated).toBe(true);expect(body.chogs).toEqual([]);expect(body.sources).toEqual([]);
 const cookie=response.headers.get('set-cookie')!;expect(cookie).toContain('HttpOnly; SameSite=Lax');
 const pair=cookie.split(';')[0]!,token=pair.split('=')[1]!;
 expect(JSON.stringify(body)).not.toContain(token);expect(body).not.toHaveProperty('session');
 expect((await fetch(origin+'/api/me/chogs',{headers:{cookie:pair}})).status).toBe(200);
 expect((await post('/auth/verify',{nonce:challenge.nonce,signature})).status).toBe(401);
 expect((await fetch(origin+'/api/session',{method:'POST'})).status).toBe(404);
}));
test('an injected wallet verifier yields a paginated real-holder roster with source links and no career writes',async()=>harness(async({root,origin,post})=>{
 const counts=new Map<string,number>();for(const row of ownerDirectory(snapshot).values())counts.set(row.owner,(counts.get(row.owner)??0)+1);
 const [wallet,total]=[...counts].sort((a,b)=>b[1]-a[1])[0]!;expect(total).toBeGreaterThan(50);
 const challenge=await (await post('/auth/nonce',{address:wallet})).json();
 const account=privateKeyToAccount(generatePrivateKey()),signature=await account.signMessage({message:challenge.message});
 const response=await post('/auth/verify',{nonce:challenge.nonce,signature});expect(response.status).toBe(200);
 const cookie=response.headers.get('set-cookie')!.split(';')[0]!,seen=new Set<number>();let after=0;
 do{
  const page=await (await fetch(origin+'/me/chogs?after='+after+'&limit=24',{headers:{cookie}})).json();
  expect(page.total).toBe(total);expect(page.chogs.length).toBeLessThanOrEqual(24);
  for(const chog of page.chogs){expect(chog.name).toBe(metadata.get(chog.tokenId)?.metadata.name);expect(chog).not.toHaveProperty('owner');expect(chog).not.toHaveProperty('duties');seen.add(chog.tokenId);}
  expect(page.sources.some((s:{kind:string})=>s.kind==='METADATA')).toBe(true);
  if(page.nextCursor===null)break;expect(page.nextCursor).toBeGreaterThan(after);after=page.nextCursor;
 }while(true);
 expect(seen.size).toBe(total);
 await expect(readdir(join(root,'runs/career'))).rejects.toMatchObject({code:'ENOENT'});
 expect((await fetch(origin+'/me/chogs?limit=1000',{headers:{cookie}})).status).toBe(400);
},true));
test('cross-origin writes and incorrect signatures cannot create a wallet session',async()=>harness(async({post})=>{
 const owner=privateKeyToAccount(generatePrivateKey()),other=privateKeyToAccount(generatePrivateKey());
 expect((await post('/auth/nonce',{address:owner.address},'https://elsewhere.example')).status).toBe(403);
 const challenge=await (await post('/auth/nonce',{address:owner.address})).json();
 const signature=await other.signMessage({message:challenge.message});
 const response=await post('/auth/verify',{nonce:challenge.nonce,signature});
 expect(response.status).toBe(401);expect(response.headers.get('set-cookie')).toBeNull();
}));
test('sign-in POSTs are limited to sixty per network per minute',async()=>harness(async({post,setNow})=>{
 for(let n=0;n<60;n++)expect((await post('/auth/nonce',{address:'invalid'})).status).toBe(400);
 expect((await post('/auth/nonce',{address:'invalid'})).status).toBe(429);
 setNow(snapshot.indexedAt+65_001);
 expect((await post('/auth/nonce',{address:'invalid'})).status).toBe(400);
}));
