import {mkdir,readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {answerHash,validateCase,type CaseDraft} from '../../cases/src/build.mts';
import {type CaseChain,type ChainReceipt} from '../../chain/src/casebook.mts';
import {atomicJSON,type CaseVault} from './vault.mts';
export interface Publication {
 v:1;id:string;day:string;kind:'MAIN'|'COLD';source:'FRESH'|'COLD_FALLBACK';
 opensAt:number;closesAt:number;answerHash:string;
 status:'PREPARED'|'COMMITTED'|'PUBLISHED'|'CLOSED'|'COMPLETE';
 contract:string;chainId:143;preparedAt:string;publishedAt:string|null;
 open:ChainReceipt|null;close:ChainReceipt|null;cast:ChainReceipt|null;
}
export function dailyDraft(source:CaseDraft,day:string,kind:'MAIN'|'COLD'='MAIN'){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day)throw new Error('PUBLISH_DAY: Invalid UTC day');
 const draft=structuredClone(source);draft.public.id=`${day}-${kind.toLowerCase()}`;
 delete draft.private.key.contentHash;
 draft.private.salt=`0x${randomBytes(32).toString('hex')}`;
 draft.public.answerHash=answerHash(draft.public.id,draft.private.key,draft.private.salt);
 if(validateCase(draft).length)throw new Error('PUBLISH_CASE: Invalid draft');
 return draft;
}
export class Publisher {
 constructor(private directory:string,private vault:CaseVault,private chain:CaseChain,private now=()=>Date.now()){}
 private path(id:string){if(!/^\d{4}-\d{2}-\d{2}-(main|cold)$/.test(id))throw new Error('PUBLISH_ID: Invalid daily identifier');return join(this.directory,`${id}.json`);}
 async read(id:string):Promise<Publication|null>{try{return JSON.parse(await readFile(this.path(id),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
 async prepare(source:CaseDraft,day:string,sourceKind:Publication['source'],opensAt:number,closesAt:number,kind:Publication['kind']='MAIN'){
  const id=`${day}-${kind.toLowerCase()}`,saved=await this.read(id);
  if(saved){if(saved.contract.toLowerCase()!==this.chain.address.toLowerCase()||saved.opensAt!==opensAt||saved.closesAt!==closesAt)throw new Error('PUBLISH_CONFLICT: Existing publication differs');return saved;}
  if(!Number.isSafeInteger(opensAt)||!Number.isSafeInteger(closesAt)||closesAt<=opensAt||closesAt*1000<=this.now())throw new Error('PUBLISH_TIME: Invalid publication window');
  const draft=source.public.id===id?structuredClone(source):dailyDraft(source,day,kind);if(validateCase(draft).length)throw new Error('PUBLISH_CASE: Invalid prepared draft');await this.vault.save(draft);
  const record:Publication={v:1,id,day,kind,source:sourceKind,opensAt,closesAt,answerHash:draft.public.answerHash,status:'PREPARED',contract:this.chain.address,chainId:143,preparedAt:new Date(this.now()).toISOString(),publishedAt:null,open:null,close:null,cast:null};
  await mkdir(this.directory,{recursive:true,mode:0o700});await atomicJSON(this.path(id),record);return record;
 }
 async publish(id:string){
  const record=await this.read(id);if(!record)throw new Error('PUBLISH_MISSING: Prepare the case first');
  if(record.contract.toLowerCase()!==this.chain.address.toLowerCase())throw new Error('PUBLISH_CONFLICT: Publication belongs to another contract');
  if(['PUBLISHED','CLOSED','COMPLETE'].includes(record.status))return record;
  if(record.closesAt*1000<=this.now())throw new Error('PUBLISH_EXPIRED: Never open an expired case');
  const draft=await this.vault.load(id);if(draft.public.answerHash!==record.answerHash||validateCase(draft).length)throw new Error('PUBLISH_HASH: Encrypted draft differs');
  const observed=await this.chain.inspect(id);
  if(observed.hash!=='0x'+'0'.repeat(64)&&observed.hash!==record.answerHash)throw new Error('PUBLISH_CONFLICT: Different key already committed');
  if(observed.closed)throw new Error('PUBLISH_CLOSED: Chain case is already closed');
  // The chain adapter journals a signed transaction before broadcast, so a restart
  // retries the same bytes and nonce instead of signing a second transaction.
  const receipt=await this.chain.open(draft,record.opensAt,record.closesAt);
  const confirmed=await this.chain.inspect(id);
  if(confirmed.hash!==record.answerHash||confirmed.closed||confirmed.opensAt!==record.opensAt||confirmed.closesAt!==record.closesAt||receipt.status!=='success'||receipt.chainId!==143||receipt.address.toLowerCase()!==record.contract.toLowerCase())throw new Error('PUBLISH_CHAIN: Commitment not confirmed');
  record.open=receipt;record.status='COMMITTED';await atomicJSON(this.path(id),record);
  if(this.now()<record.opensAt*1000)return record;
  record.status='PUBLISHED';record.publishedAt=new Date(this.now()).toISOString();await atomicJSON(this.path(id),record);return record;
 }
 async close(id:string){
  const record=await this.read(id);if(!record?.open)throw new Error('PUBLISH_MISSING: No committed case to close');
  if(record.contract.toLowerCase()!==this.chain.address.toLowerCase())throw new Error('PUBLISH_CONFLICT: Publication belongs to another contract');
  if(record.status==='COMPLETE')return record;
  if(this.now()<record.closesAt*1000)throw new Error('PUBLISH_EARLY: Answers stay private until close');
  const draft=await this.vault.load(id);
  record.close=await this.chain.close(draft);record.status='CLOSED';await atomicJSON(this.path(id),record);
  const observed=await this.chain.inspect(id);if(!observed.closed||observed.hash!==record.answerHash)throw new Error('PUBLISH_CHAIN: Close not confirmed');
  record.cast=await this.chain.cast(draft);record.status='COMPLETE';await atomicJSON(this.path(id),record);return record;
 }
}
