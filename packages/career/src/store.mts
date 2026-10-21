import {createHash,randomBytes} from 'node:crypto';
import {mkdir,open,readFile,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {getAddress,type Address} from 'viem';
import {withPlayerLock} from '../../game/src/player-lock.mts';

export class CareerError extends Error {constructor(public readonly code:string,message:string){super(message);}}
export type Grade='A'|'B'|'C'|'D';
export interface DetectiveResult {caseId:string;day:string;grade:Grade;score:number;perfect:boolean;caught:number[];transferredMidCase:boolean}
interface Duty {caseId:string;day:string;wallet:Address;startedAt:number;result:DetectiveResult|null}
export interface Career {
 v:2;tokenId:number;duties:Duty[];solves:number;grades:Record<Grade,number>;liesCaught:number;perfectCases:number;
 streak:number;bestStreak:number;freezes:number;lastDay:string|null;lastFounderWeek:string|null;gallery:number[];
}
const validToken=(id:number)=>Number.isSafeInteger(id)&&id>=1&&id<=1969;
function dayTime(day:string){const time=Date.parse(day+'T00:00:00Z');if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==day)throw new CareerError('CAREER_DAY_INVALID','The case day is invalid.');return time;}
function blank(tokenId:number):Career{return {v:2,tokenId,duties:[],solves:0,grades:{A:0,B:0,C:0,D:0},liesCaught:0,perfectCases:0,streak:0,bestStreak:0,freezes:0,lastDay:null,lastFounderWeek:null,gallery:[]};}
function prepareDay(career:Career,day:string,founder:boolean){
 const current=dayTime(day),previous=career.lastDay===null?null:dayTime(career.lastDay);
 if(previous!==null&&current<=previous)throw new CareerError('CAREER_DAY_ORDER','A newer case is already recorded.');
 // Accrue weekly Founder freezes before consuming missed days in that week.
 const start=previous===null?current:previous+86400000;
 for(let at=start;at<=current;at+=86400000){
  const date=new Date(at),weekday=(date.getUTCDay()+6)%7,week=new Date(at-weekday*86400000).toISOString().slice(0,10);
  if(founder&&career.lastFounderWeek!==week){career.freezes=Math.min(2,career.freezes+1);career.lastFounderWeek=week;}
  if(at<current&&career.streak>0){if(career.freezes>0)career.freezes--;else career.streak=0;}
 }
}
function creditDay(career:Career,day:string,founder:boolean){
 prepareDay(career,day,founder);
 career.streak++;career.bestStreak=Math.max(career.bestStreak,career.streak);career.lastDay=day;
 if(career.streak%7===0)career.freezes=Math.min(2,career.freezes+1);
}
export function careerStatus(career:Career,day:string,founder:boolean){
 dayTime(day);const next=structuredClone(career);if(career.lastDay!==day)prepareDay(next,day,founder);
 return {solves:next.solves,rank:careerRank(next.solves),streak:next.streak,bestStreak:next.bestStreak,freezes:next.freezes};
}
export function careerRank(solves:number){return solves>=50?'Chief':solves>=25?'Inspector':solves>=10?'Detective':solves>=3?'Gumshoe':'Rookie';}
export class CareerStore {
 constructor(private readonly root:string){}
 private path(tokenId:number){if(!validToken(tokenId))throw new CareerError('CAREER_TOKEN_INVALID','Choose a Chog from the collection.');return join(this.root,'runs/career',String(tokenId)+'.json');}
 private async read(tokenId:number):Promise<Career>{
  try{const career=JSON.parse(await readFile(this.path(tokenId),'utf8')) as Career;
   if(career.v!==2||career.tokenId!==tokenId||!Array.isArray(career.duties)||
    ![career.solves,career.liesCaught,career.perfectCases,career.streak,career.bestStreak,career.freezes].every(n=>Number.isSafeInteger(n)&&n>=0)||career.freezes>2||
    !career.grades||!['A','B','C','D'].every(grade=>Number.isSafeInteger(career.grades[grade as Grade])&&career.grades[grade as Grade]>=0)||
    !Array.isArray(career.gallery)||career.gallery.some(id=>!validToken(id))||new Set(career.gallery).size!==career.gallery.length||
    ![career.lastDay,career.lastFounderWeek].every(day=>day===null||typeof day==='string'&&Number.isFinite(Date.parse(day+'T00:00:00Z')))||
    career.duties.some(duty=>typeof duty.caseId!=='string'||typeof duty.day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(duty.day)||!Number.isSafeInteger(duty.startedAt)||typeof duty.wallet!=='string'||!(duty.result===null||duty.result&&duty.result.caseId===duty.caseId&&duty.result.day===duty.day)))throw new CareerError('CAREER_STORAGE_INVALID','The detective record could not be read.');return career;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return blank(tokenId);throw error;}
 }
 private async write(career:Career){
  const path=this.path(career.tokenId);await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.'+randomBytes(8).toString('hex')+'.tmp',file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(career));await file.sync();}finally{await file.close();}
  await rename(temporary,path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
 }
 private async locked<T>(tokenId:number,action:()=>Promise<T>){this.path(tokenId);return withPlayerLock(this.root,createHash('sha256').update('career:'+tokenId).digest('hex'),action);}
 async profile(tokenId:number){return this.read(tokenId);}
 async start(input:{mode:'HOLDER';tokenId:number;wallet:string;caseId:string;day:string;now:number}){
  if(input.mode!=='HOLDER')throw new CareerError('CAREER_HOLDER_REQUIRED','Only a held Chog keeps a detective record.');
  dayTime(input.day);if(!input.caseId||input.caseId.length>128||!Number.isSafeInteger(input.now)||input.now<0)throw new CareerError('CAREER_CASE_INVALID','The case identity is invalid.');
  const wallet=getAddress(input.wallet);
  return this.locked(input.tokenId,async()=>{
   const career=await this.read(input.tokenId),existing=career.duties.find(row=>row.day===input.day);
   if(existing){if(existing.result||existing.caseId!==input.caseId||existing.wallet!==wallet)throw new CareerError('PLAY_ALREADY_TODAY',"This Chog already worked today's case. Back tomorrow at 00:20 UTC.");return {career,resumed:true};}
   career.duties.push({caseId:input.caseId,day:input.day,wallet,startedAt:input.now,result:null});await this.write(career);return {career,resumed:false};
  });
 }
 async finish(input:{mode:'HOLDER';tokenId:number;wallet:string;founder:boolean;result:DetectiveResult}){
  if(input.mode!=='HOLDER')throw new CareerError('CAREER_HOLDER_REQUIRED','Only a held Chog keeps a detective record.');
  const result=input.result;dayTime(result.day);
  if(!['A','B','C','D'].includes(result.grade)||!Number.isSafeInteger(result.score)||result.score<0||typeof result.perfect!=='boolean'||typeof result.transferredMidCase!=='boolean'||typeof input.founder!=='boolean'||!Array.isArray(result.caught)||result.caught.length>3||result.caught.some(id=>!validToken(id)))throw new CareerError('CAREER_RESULT_INVALID','The case result is invalid.');
  return this.locked(input.tokenId,async()=>{
   const career=await this.read(input.tokenId),duty=career.duties.find(row=>row.day===result.day&&row.caseId===result.caseId);
   if(!duty||duty.wallet!==getAddress(input.wallet))throw new CareerError('CAREER_SESSION_MISMATCH','This case belongs to another detective session.');
   if(duty.result){if(JSON.stringify(duty.result)!==JSON.stringify(result))throw new CareerError('PLAY_ALREADY_TODAY','This case is already recorded.');return career;}
   creditDay(career,result.day,input.founder);duty.result=structuredClone(result);career.grades[result.grade]++;
   if(result.grade!=='D')career.solves++;
   career.liesCaught+=result.caught.length;if(result.perfect)career.perfectCases++;
   career.gallery=[...new Set([...career.gallery,...result.caught])].sort((a,b)=>a-b);
   await this.write(career);return career;
  });
 }
}
