import {createHash,createHmac,randomBytes} from 'node:crypto';
import {mkdir,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {isIP} from 'node:net';
import type {Metadata} from '../../cases/src/build.mts';
import {detectiveFor,rookieQuestionBudget} from '../../traits/src/detective.mts';
import {atomicJSON} from '../../publishing/src/vault.mts';
import {withPlayerLock} from './player-lock.mts';

export class RookieError extends Error {constructor(public readonly code:string,message:string,public readonly status=400){super(message);}}
export interface RookieCase {id:string;day:string;opensAt:number;closesAt:number;salt:string;cast:number[]}
export interface RookieBadge {tokenId:number;name:string;skill:ReturnType<typeof detectiveFor>['skill'];skillName:string;uses:number;questions:number;label:string}
export interface RookieSession<S> {mode:'ROOKIE';caseId:string;badge:RookieBadge;state:S;revision:number;done:boolean;startedAt:number}
interface Desk<S> {v:1;caseId:string;opensAt:number;expiresAt:number;sessions:Record<string,RookieSession<S>>;quotaDay:string;quotaSalt:string;browsers:string[];ips:Record<string,number>}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const lockId=digest('rookie-desk'),tokenValid=(value:string)=>/^[a-f0-9]{64}$/.test(value);
const validId=(value:number)=>Number.isSafeInteger(value)&&value>=1&&value<=1969;
function network(ip:string){
 if(!isIP(ip))throw new RookieError('ROOKIE_NETWORK_INVALID','The Rookie desk could not check this network.',503);
 if(isIP(ip)===4)return ip;
 const normalized=new URL('http://['+ip+']/').hostname.slice(1,-1),mapped=/^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
 if(!mapped)return normalized;
 const upper=parseInt(mapped[1]!,16),lower=parseInt(mapped[2]!,16);return [upper>>8,upper&255,lower>>8,lower&255].join('.');
}
export class RookieDesk<S> {
 private readonly path:string;
 constructor(private readonly options:{root:string;metadata:ReadonlyMap<number,Metadata>;now?:()=>number;secure?:boolean}){this.path=join(options.root,'runs/rookie/desk.json');}
 private clock(){const now=(this.options.now??Date.now)();if(!Number.isSafeInteger(now)||now<0)throw new RookieError('ROOKIE_CLOCK_INVALID','The Rookie desk time is unavailable.',503);return now;}
 private validate(current:RookieCase,now:number){
  if(!current.id||current.id.length>128||!/^0x[a-f0-9]{64}$/i.test(current.salt)||![current.opensAt,current.closesAt].every(t=>Number.isSafeInteger(t)&&t>=0)||current.closesAt<=current.opensAt||new Date(current.opensAt).toISOString().slice(0,10)!==current.day||![3,4].includes(current.cast.length)||new Set(current.cast).size!==current.cast.length||!current.cast.every(validId))throw new RookieError('ROOKIE_CASE_INVALID','The Rookie case could not be checked.',503);
  if(now<current.opensAt||now>=current.closesAt)throw new RookieError('ROOKIE_CASE_CLOSED','The next Rookie case is not open yet.',409);
 }
 private async load():Promise<Desk<S>|null>{
  try{const value=JSON.parse(await readFile(this.path,'utf8')) as Desk<S>;
   if(!value||typeof value!=='object'||value.v!==1||typeof value.caseId!=='string'||!Number.isSafeInteger(value.opensAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=value.opensAt||!value.sessions||typeof value.sessions!=='object'||Array.isArray(value.sessions)||Object.entries(value.sessions).some(([id,s])=>!tokenValid(id)||!s||s.mode!=='ROOKIE'||s.caseId!==value.caseId||typeof s.done!=='boolean'||!Number.isSafeInteger(s.revision)||s.revision<0)||!Array.isArray(value.browsers)||!value.browsers.every(tokenValid)||!value.ips||typeof value.ips!=='object'||typeof value.quotaDay!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value.quotaDay)||typeof value.quotaSalt!=='string'||!tokenValid(value.quotaSalt)||Object.entries(value.ips).some(([id,n])=>!tokenValid(id)||!Number.isSafeInteger(n)||n<0||n>20))throw new RookieError('ROOKIE_STORAGE_INVALID','The Rookie desk could not be read.',503);
   return value;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;if(error instanceof RookieError)throw error;throw new RookieError('ROOKIE_STORAGE_INVALID','The Rookie desk could not be read.',503);}
 }
 private async save(desk:Desk<S>){await mkdir(join(this.options.root,'runs/rookie'),{recursive:true,mode:0o700});await atomicJSON(this.path,desk);}
 private rotate(previous:Desk<S>|null,current:RookieCase,now:number):Desk<S>{
  const day=new Date(now).toISOString().slice(0,10),sameDay=previous?.quotaDay===day;
  if(previous&&previous.caseId===current.id){
   if(previous.opensAt!==current.opensAt||previous.expiresAt!==current.closesAt)throw new RookieError('ROOKIE_CASE_CHANGED','The published case window changed.',503);
   return {...previous,quotaDay:day,quotaSalt:sameDay?previous.quotaSalt:randomBytes(32).toString('hex'),browsers:sameDay?previous.browsers:[],ips:sameDay?previous.ips:{}};
  }
  if(previous&&current.opensAt<=previous.opensAt)throw new RookieError('ROOKIE_CASE_CHANGED','The Rookie desk received an older case.',503);
  return {v:1,caseId:current.id,opensAt:current.opensAt,expiresAt:current.closesAt,sessions:{},quotaDay:day,quotaSalt:sameDay?previous!.quotaSalt:randomBytes(32).toString('hex'),browsers:sameDay?previous!.browsers:[],ips:sameDay?previous!.ips:{}};
 }
 private async active(current:RookieCase,now:number){
  const previous=await this.load(),desk=this.rotate(previous,current,now);
  if(previous&&(previous.caseId!==desk.caseId||previous.quotaDay!==desk.quotaDay))await this.save(desk);
  return desk;
 }
 cookie(token:string){if(!tokenValid(token))throw new RookieError('ROOKIE_SESSION_INVALID','Open the Rookie desk again.');return `chog_noir_rookie=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=172800${this.options.secure===false?'':'; Secure'}`;}
 async start(current:RookieCase,input:{browserToken?:string;ip:string;create:(badge:RookieBadge)=>S}){
  const now=this.clock();this.validate(current,now);
  const address=network(input.ip);
  if(input.browserToken!==undefined&&!tokenValid(input.browserToken))throw new RookieError('ROOKIE_SESSION_INVALID','Open the Rookie desk again.');
  return withPlayerLock(this.options.root,lockId,async()=>{
   const now=this.clock();this.validate(current,now);
   const desk=await this.active(current,now),token=input.browserToken??randomBytes(32).toString('hex'),id=digest(token);
   if(desk.sessions[id])return {token,session:structuredClone(desk.sessions[id]!),resumed:true};
   if(desk.browsers.includes(id))throw new RookieError('ROOKIE_DONE_TODAY',"You've worked today's case at the Rookie desk. A new case opens at 00:20 UTC.",409);
   const ip=createHmac('sha256',desk.quotaSalt).update(address).digest('hex');
   if((desk.ips[ip]??0)>=20)throw new RookieError('ROOKIE_LIMIT','The Rookie desk is busy from this network. Try again later.',429);
   if(this.options.metadata.size!==1969)throw new RookieError('ROOKIE_BADGES_MISSING','The bureau badges are unavailable.',503);
   const pool=[...this.options.metadata.keys()].filter(id=>validId(id)&&!current.cast.includes(id)).sort((a,b)=>a-b);
   if(pool.length!==1969-current.cast.length)throw new RookieError('ROOKIE_BADGES_MISSING','The bureau badges are unavailable.',503);
   const selected=pool[Number(BigInt('0x'+createHmac('sha256',current.salt).update(token).digest('hex'))%BigInt(pool.length))]!;
   const detective=detectiveFor(selected,this.options.metadata.get(selected)!);
   const badge:RookieBadge={tokenId:selected,name:detective.name,skill:detective.skill,skillName:detective.skillName,uses:detective.uses,questions:rookieQuestionBudget(detective.skill).total,label:`Rookie desk · bureau badge ${detective.name} · nothing you do here is kept.`};
   const session:RookieSession<S>={mode:'ROOKIE',caseId:current.id,badge,state:input.create(structuredClone(badge)),revision:0,done:false,startedAt:now};
   desk.sessions[id]=session;desk.browsers.push(id);desk.ips[ip]=(desk.ips[ip]??0)+1;await this.save(desk);
   return {token,session:structuredClone(session),resumed:false};
  });
 }
 async action(current:RookieCase,token:string,revision:number,reduce:(state:S,badge:RookieBadge)=>{state:S;done:boolean}){
  const now=this.clock();this.validate(current,now);
  if(!tokenValid(token))throw new RookieError('ROOKIE_SESSION_INVALID','Open the Rookie desk again.',401);
  return withPlayerLock(this.options.root,lockId,async()=>{
   const now=this.clock();this.validate(current,now);
   const desk=await this.active(current,now),id=digest(token),session=desk.sessions[id];
   if(!session)throw new RookieError('ROOKIE_SESSION_INVALID','Open the Rookie desk again.',401);
   if(session.done)throw new RookieError('ROOKIE_DONE_TODAY',"You've worked today's case at the Rookie desk. A new case opens at 00:20 UTC.",409);
   if(!Number.isSafeInteger(revision)||revision!==session.revision)throw new RookieError('ROOKIE_REVISION_CHANGED','The case changed. Use the latest view.',409);
   const next=reduce(structuredClone(session.state),structuredClone(session.badge));
   if(typeof next.done!=='boolean')throw new RookieError('ROOKIE_ACTION_INVALID','The case action could not be checked.',503);
   session.state=next.state;session.done=next.done;session.revision++;await this.save(desk);return structuredClone(session);
  });
 }
 /** Reads a rookie session without creating, rotating or saving anything. */
 async peek(current:RookieCase,token:string){
  if(!tokenValid(token))return null;
  const desk=await this.load();if(!desk||desk.caseId!==current.id)return null;
  const session=desk.sessions[digest(token)];return session?structuredClone(session):null;
 }
 async count(current:RookieCase){const now=this.clock();this.validate(current,now);const desk=await this.load();return desk?.caseId===current.id?Object.keys(desk.sessions).length:0;}
 async expire(){
  const now=this.clock();return withPlayerLock(this.options.root,lockId,async()=>{
   const desk=await this.load();if(!desk||desk.expiresAt>now)return false;
   // Preserve only today's short-lived quota through a midnight case change.
   const today=new Date(now).toISOString().slice(0,10);
   if(desk.quotaDay===today){desk.sessions={};await this.save(desk);}else await unlink(this.path);
   return true;
  });
 }
}
