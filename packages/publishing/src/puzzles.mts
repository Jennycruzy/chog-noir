import {mkdir,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validatePuzzle,puzzleHash,type PuzzleCase} from '../../cases/src/puzzle.mts';
import type {ChainReceipt,PuzzleChain,SolveRecord} from '../../chain/src/casebook.mts';
import {atomicJSON,type CaseVault} from './vault.mts';

export interface PuzzlePublication {
 v:2;id:string;day:string;source:'FRESH'|'COLD_FALLBACK';number:number;
 opensAt:number;closesAt:number;answerHash:string;
 status:'PREPARED'|'COMMITTED'|'PUBLISHED'|'CLOSED'|'CAST_RECORDED'|'COMPLETE';
 contract:string;chainId:143;preparedAt:string;publishedAt:string|null;
 open:ChainReceipt|null;close:ChainReceipt|null;cast:ChainReceipt|null;solves:ChainReceipt[]|null;solveCount:number|null;
}
const dayValid=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;

/** One shared daily case. The answer key is committed on chain before the case is published, and revealed after it closes. */
export class PuzzlePublisher {
 constructor(private directory:string,private vault:CaseVault,private chain:PuzzleChain,private now=()=>Date.now()){}
 private path(day:string){if(!dayValid(day))throw new Error('PUBLISH_DAY: Invalid UTC day');return join(this.directory,day+'.json');}
 async read(day:string):Promise<PuzzlePublication|null>{try{return JSON.parse(await readFile(this.path(day),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
 async list():Promise<PuzzlePublication[]>{
  const files=await readdir(this.directory).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return [] as string[];throw error;});
  return (await Promise.all(files.filter(file=>/^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().map(file=>this.read(file.slice(0,-5))))).filter((row):row is PuzzlePublication=>!!row);
 }
 async puzzle(record:PuzzlePublication):Promise<PuzzleCase>{
  const puzzle=await this.vault.open<PuzzleCase>(record.id);
  if(puzzle.file.id!==record.id||puzzle.answerHash!==record.answerHash||puzzleHash(puzzle)!==record.answerHash||validatePuzzle(puzzle).length)throw new Error('PUBLISH_HASH: Encrypted case differs from its commitment');
  return puzzle;
 }
 private owned(record:PuzzlePublication){if(record.contract.toLowerCase()!==this.chain.address.toLowerCase())throw new Error('PUBLISH_CONFLICT: Publication belongs to another contract');}
 async prepare(puzzle:PuzzleCase,source:PuzzlePublication['source']){
  const day=puzzle.file.day,saved=await this.read(day);
  if(puzzle.file.mode!=='DAILY'||validatePuzzle(puzzle).length||puzzle.answerHash!==puzzleHash(puzzle))throw new Error('PUBLISH_CASE: Only a validated daily case can be prepared');
  if(saved){this.owned(saved);if(saved.id!==puzzle.file.id||saved.answerHash!==puzzle.answerHash)throw new Error('PUBLISH_CONFLICT: A different case is already prepared for this day');return saved;}
  if(puzzle.file.closesAt*1000<=this.now())throw new Error('PUBLISH_TIME: Never prepare an expired case');
  const earlier=(await this.list()).filter(row=>row.day<day&&row.publishedAt);
  await this.vault.seal(puzzle.file.id,puzzle);
  const record:PuzzlePublication={v:2,id:puzzle.file.id,day,source,number:earlier.length+1,opensAt:puzzle.file.opensAt,closesAt:puzzle.file.closesAt,answerHash:puzzle.answerHash,status:'PREPARED',contract:this.chain.address,chainId:143,preparedAt:new Date(this.now()).toISOString(),publishedAt:null,open:null,close:null,cast:null,solves:null,solveCount:null};
  await mkdir(this.directory,{recursive:true,mode:0o700});await atomicJSON(this.path(day),record);return record;
 }
 async publish(day:string){
  const record=await this.read(day);if(!record)throw new Error('PUBLISH_MISSING: Prepare the case first');this.owned(record);
  if(['PUBLISHED','CLOSED','CAST_RECORDED','COMPLETE'].includes(record.status))return record;
  if(record.closesAt*1000<=this.now())throw new Error('PUBLISH_EXPIRED: Never open an expired case');
  const puzzle=await this.puzzle(record);
  if(!record.open){
   const observed=await this.chain.inspect(record.id);
   if(observed.hash!=='0x'+'0'.repeat(64)&&observed.hash!==record.answerHash)throw new Error('PUBLISH_CONFLICT: Different key already committed');
   if(observed.closed)throw new Error('PUBLISH_CLOSED: Chain case is already closed');
   const receipt=await this.chain.open(puzzle),confirmed=await this.chain.inspect(record.id);
   if(confirmed.hash!==record.answerHash||confirmed.closed||confirmed.opensAt!==record.opensAt||confirmed.closesAt!==record.closesAt||receipt.status!=='success'||receipt.chainId!==143||receipt.address.toLowerCase()!==record.contract.toLowerCase())throw new Error('PUBLISH_CHAIN: Commitment not confirmed');
   record.open=receipt;record.status='COMMITTED';await atomicJSON(this.path(day),record);
  }
  if(this.now()<record.opensAt*1000)return record;
  record.status='PUBLISHED';record.publishedAt=new Date(this.now()).toISOString();await atomicJSON(this.path(day),record);return record;
 }
 /** Reveals the key and records the cast. Answers stay private until the scheduled close. */
 async close(day:string){
  const record=await this.read(day);if(!record?.open)throw new Error('PUBLISH_MISSING: No committed case to close');this.owned(record);
  if(['CAST_RECORDED','COMPLETE'].includes(record.status))return record;
  if(this.now()<record.closesAt*1000)throw new Error('PUBLISH_EARLY: Answers stay private until close');
  const puzzle=await this.puzzle(record);
  if(!record.close){
   record.close=await this.chain.close(puzzle);
   const observed=await this.chain.inspect(record.id);if(!observed.closed||observed.hash!==record.answerHash)throw new Error('PUBLISH_CHAIN: Close not confirmed');
   record.status='CLOSED';await atomicJSON(this.path(day),record);
  }
  record.cast=await this.chain.cast(puzzle);record.status='CAST_RECORDED';await atomicJSON(this.path(day),record);return record;
 }
 /** Writes every finished holder result for the case, at most 200 per transaction. Rookie results never reach this method. */
 async recordSolves(day:string,rows:readonly SolveRecord[]){
  const record=await this.read(day);if(!record)throw new Error('PUBLISH_MISSING: No case for this day');this.owned(record);
  if(record.status==='COMPLETE')return record;
  if(record.status!=='CAST_RECORDED')throw new Error('PUBLISH_ORDER: Close the case and record its cast first');
  const ordered=[...rows].sort((a,b)=>a.tokenId-b.tokenId);
  if(new Set(ordered.map(row=>row.tokenId)).size!==ordered.length)throw new Error('PUBLISH_SOLVES: A detective can be recorded once per case');
  const puzzle=await this.puzzle(record),receipts:ChainReceipt[]=[];
  for(let chunk=0;chunk*200<ordered.length;chunk++)receipts.push(await this.chain.solves(puzzle,chunk,ordered.slice(chunk*200,chunk*200+200)));
  record.solves=receipts;record.solveCount=ordered.length;record.status='COMPLETE';await atomicJSON(this.path(day),record);return record;
 }
}

/** Read-only view for the game API: only cases whose on-chain lock is confirmed and whose opening time has passed are served. */
export class PublishedPuzzles {
 private readonly cache=new Map<string,PuzzleCase>();
 constructor(private directory:string,private vault:CaseVault){}
 async list():Promise<PuzzlePublication[]>{
  const files=await readdir(this.directory).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return [] as string[];throw error;});
  const rows:PuzzlePublication[]=[];
  for(const file of files.filter(name=>/^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()){const record=JSON.parse(await readFile(join(this.directory,file),'utf8')) as PuzzlePublication;if(record.v===2&&record.open&&record.publishedAt)rows.push(record);}
  return rows;
 }
 async puzzle(record:PuzzlePublication){
  const cached=this.cache.get(record.id);if(cached&&cached.answerHash===record.answerHash)return cached;
  const puzzle=await this.vault.open<PuzzleCase>(record.id);
  if(puzzle.file.id!==record.id||puzzle.answerHash!==record.answerHash||puzzleHash(puzzle)!==record.answerHash||validatePuzzle(puzzle).length)throw new Error('PUBLISH_HASH: Encrypted case differs from its commitment');
  this.cache.set(record.id,puzzle);return puzzle;
 }
 async current(now:number){
  const record=(await this.list()).find(row=>row.opensAt*1000<=now&&now<row.closesAt*1000);
  return record?{record,puzzle:await this.puzzle(record)}:null;
 }
 async byId(id:string){
  const record=(await this.list()).find(row=>row.id===id);
  return record?{record,puzzle:await this.puzzle(record)}:null;
 }
}
