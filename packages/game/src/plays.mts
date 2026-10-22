import {createHash,randomBytes} from 'node:crypto';
import {mkdir,open,readFile,readdir,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {getAddress,type Address} from 'viem';
import type {PuzzleSession} from './puzzle-session.mts';
import {withPlayerLock} from './player-lock.mts';

export class PlayError extends Error {constructor(public readonly code:string,message:string,public readonly status=400){super(message);}}
/** A witness the detective's Chog already knows: its first Press is free. Facts only, with their sources. */
export interface KnownWitness {witness:number;kind:'LOOK'|'WALLET'|'MINT';reason:string}
/** One holder Chog's work on one case. Careers live separately on the token; this is the case-day state. */
export interface HolderPlay {
 v:1;caseId:string;tokenId:number;wallet:Address;founder:boolean;startedAt:number;
 session:PuzzleSession;known:KnownWitness[];catches:number[];finishedAt:number|null;transferredMidCase:boolean;
 /** burnNonce binds a $CHOG burn to this play; chogStamp records that the wallet held $CHOG when the case started. */
 burnNonce:string;chogStamp:boolean;
}
const validToken=(id:number)=>Number.isSafeInteger(id)&&id>=1&&id<=1969;
const validCase=(id:string)=>/^case-[a-f0-9]{24}$/.test(id);

export class HolderPlays {
 constructor(private readonly root:string){}
 private path(caseId:string,tokenId:number){if(!validCase(caseId)||!validToken(tokenId))throw new PlayError('PLAY_INPUT_INVALID','Choose a Chog for this case.');return join(this.root,'runs/play',caseId,tokenId+'.json');}
 private async write(play:HolderPlay){
  const path=this.path(play.caseId,play.tokenId);await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.'+randomBytes(8).toString('hex')+'.tmp',file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(play));await file.sync();}finally{await file.close();}
  await rename(temporary,path);
 }
 private parse(text:string,caseId:string,tokenId:number):HolderPlay{
  const play=JSON.parse(text) as HolderPlay;
  if(play.v!==1||play.caseId!==caseId||play.tokenId!==tokenId||play.session?.caseId!==caseId||play.session.mode!=='HOLDER'||play.session.detective.tokenId!==tokenId||!Array.isArray(play.catches)||!Array.isArray(play.known)||typeof play.founder!=='boolean'||typeof play.transferredMidCase!=='boolean'||!/^[a-f0-9]{32}$/.test(play.burnNonce)||typeof play.chogStamp!=='boolean')throw new PlayError('PLAY_STORAGE_INVALID','This case record could not be read.',503);
  return play;
 }
 async read(caseId:string,tokenId:number):Promise<HolderPlay|null>{
  try{return this.parse(await readFile(this.path(caseId,tokenId),'utf8'),caseId,tokenId);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 }
 /** Serialises every change to one token's case, across processes. */
 locked<T>(caseId:string,tokenId:number,action:()=>Promise<T>){this.path(caseId,tokenId);return withPlayerLock(this.root,createHash('sha256').update('play:'+caseId+':'+tokenId).digest('hex'),action);}
 async create(play:HolderPlay){
  if(await this.read(play.caseId,play.tokenId))throw new PlayError('PLAY_ALREADY_TODAY',"This Chog already worked today's case. Back tomorrow at 00:20 UTC.",409);
  await this.write({...play,wallet:getAddress(play.wallet)});return play;
 }
 async save(play:HolderPlay){await this.write(play);return play;}
 /** Every holder play on one case, for the Precinct board and global stats. */
 async all(caseId:string):Promise<HolderPlay[]>{
  if(!validCase(caseId))throw new PlayError('PLAY_INPUT_INVALID','Choose a case.');
  const files=await readdir(join(this.root,'runs/play',caseId)).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return [] as string[];throw error;});
  const plays:HolderPlay[]=[];
  for(const file of files.filter(name=>/^\d+\.json$/.test(name))){const tokenId=Number(file.slice(0,-5));const play=await this.read(caseId,tokenId);if(play)plays.push(play);}
  return plays.sort((a,b)=>a.startedAt-b.startedAt||a.tokenId-b.tokenId);
 }
}
