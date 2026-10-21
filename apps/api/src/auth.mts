import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {AuthError,WalletAuth} from '../../../packages/auth/src/auth.mts';
import {DetectiveRoster} from '../../../packages/auth/src/roster.mts';

export function holderRoutes(options:{origin:string;auth:WalletAuth;roster:DetectiveRoster;trustProxy?:boolean;now?:()=>number}){
 const origin=new URL(options.origin).origin,now=options.now??Date.now,rateSalt=randomBytes(32).toString('hex');
 const rates=new Map<string,{count:number;until:number}>();
 function network(request:IncomingMessage){
  let ip=request.socket.remoteAddress??'';
  if(options.trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)&&typeof request.headers['x-real-ip']==='string')ip=request.headers['x-real-ip'];
  if(!isIP(ip))throw new AuthError('AUTH_NETWORK_INVALID','The sign-in network could not be checked.',503);return ip;
 }
 function rate(request:IncomingMessage){
  const at=now();for(const [key,value] of rates)if(value.until<=at)rates.delete(key);
  const key=createHash('sha256').update(rateSalt+network(request)).digest('hex'),value=rates.get(key)??{count:0,until:at+60_000};
  if(value.count>=60)throw new AuthError('AUTH_RATE_LIMIT','Please wait a minute before trying again.',429);
  if(rates.size>=10_000&&!rates.has(key))throw new AuthError('AUTH_RATE_LIMIT','The bureau is busy. Try again shortly.',429);
  value.count++;rates.set(key,value);
 }
 function reply(response:ServerResponse,status:number,value:Record<string,unknown>){
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  response.end(JSON.stringify({v:1,generatedAt:new Date(now()).toISOString(),sources:[],...value}));
 }
 async function body(request:IncomingMessage){
  if(!request.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new AuthError('AUTH_BODY_INVALID','Send a JSON sign-in request.',415);
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;if(length>24_576)throw new AuthError('AUTH_BODY_TOO_LARGE','The sign-in request is too large.',413);chunks.push(bytes);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}catch{throw new AuthError('AUTH_BODY_INVALID','Send a valid JSON sign-in request.',400);}
 }
 function cookie(request:IncomingMessage){
  const values=(request.headers.cookie??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith('chog_noir_session='));
  if(values.length>1)throw new AuthError('AUTH_SESSION_INVALID','Connect your wallet again.');return values[0]?.slice('chog_noir_session='.length);
 }
 return async(request:IncomingMessage,response:ServerResponse):Promise<boolean>=>{
  const url=new URL(request.url??'/','http://localhost'),path=url.pathname.replace(/^\/api(?=\/)/,'');
  if(!['/auth/nonce','/auth/verify','/me/chogs'].includes(path))return false;
  try{
   const expected=path==='/me/chogs'?'GET':'POST';
   if(request.method!==expected){response.setHeader('allow',expected);throw new AuthError('AUTH_METHOD_INVALID','Use the correct sign-in method.',405);}
   if(request.method==='POST'){
    if(request.headers.origin!==origin)throw new AuthError('AUTH_ORIGIN_INVALID','Sign in from the bureau website.',403);rate(request);
   }
   if(path==='/auth/nonce'){
    const value=await body(request);if(typeof value.address!=='string')throw new AuthError('AUTH_ADDRESS_INVALID','Connect a valid wallet.',400);
    reply(response,200,await options.auth.issue(value.address));return true;
   }
   if(path==='/auth/verify'){
    const value=await body(request);if(typeof value.nonce!=='string'||typeof value.signature!=='string')throw new AuthError('AUTH_BAD_SIGNATURE',"That signature didn't check out. Try again.",400);
    const {token,session}=await options.auth.verify(value.nonce,value.signature);
    response.setHeader('set-cookie',options.auth.cookie(token));
    const roster=await options.roster.list(session.address);
    reply(response,200,{authenticated:true,address:session.address,expiresAt:session.expiresAt,...roster});return true;
   }
   const session=await options.auth.session(cookie(request));
   if(!session)throw new AuthError('AUTH_SESSION_REQUIRED','Connect your wallet first.');
   const after=url.searchParams.has('after')?Number(url.searchParams.get('after')):0,limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):24;
   reply(response,200,await options.roster.list(session.address,{after,limit}));return true;
  }catch(error){
   if(error instanceof AuthError)reply(response,error.status,{code:error.code,error:error.message});
   else reply(response,503,{code:'AUTH_SERVICE_UNAVAILABLE',error:'The bureau is temporarily unavailable. Try again.'});
   return true;
  }
 };
}
