import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {localVault} from '../../../packages/publishing/src/vault.mts';
import type {Publication} from '../../../packages/publishing/src/publish.mts';
import {validateCase,type CaseDraft} from '../../../packages/cases/src/build.mts';
export async function publishedCases(root:string,keyFile?:string){
 const records:Publication[]=[],drafts:CaseDraft[]=[],errors:{caseId:string;code:string}[]=[];
 let files:string[];
 try{files=await readdir(join(root,'runs/publications'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')errors.push({caseId:'directory',code:'PUBLICATION_DIRECTORY_UNAVAILABLE'});return {records,drafts,errors};}
 let vault:Awaited<ReturnType<typeof localVault>>|undefined;
 for(const file of files.filter(file=>/^\d{4}-\d{2}-\d{2}-(main|cold)\.json$/.test(file))){
  try{
   const record=JSON.parse(await readFile(join(root,'runs/publications',file),'utf8')) as Publication;
   if(record.id!==file.slice(0,-5)||record.day!==record.id.slice(0,10)||!['MAIN','COLD'].includes(record.kind)||!['PREPARED','COMMITTED','PUBLISHED','CLOSED','COMPLETE'].includes(record.status)||record.chainId!==143||!Number.isSafeInteger(record.opensAt)||!Number.isSafeInteger(record.closesAt)||record.closesAt<=record.opensAt||!/^0x[0-9a-f]{64}$/i.test(record.answerHash))throw new Error('PUBLICATION_RECORD');
   const now=Math.floor(Date.now()/1000),validReceipt=(receipt:NonNullable<Publication['open']>)=>receipt.status==='success'&&receipt.chainId===143&&/^0x[0-9a-f]{64}$/i.test(receipt.hash)&&/^0x[0-9a-f]{64}$/i.test(receipt.blockHash)&&/^\d+$/.test(receipt.blockNumber)&&Number.isSafeInteger(receipt.timestamp)&&receipt.timestamp<=now&&receipt.address.toLowerCase()===record.contract.toLowerCase();
   if(!/^0x[0-9a-f]{40}$/i.test(record.contract)||record.id!==record.day+'-'+record.kind.toLowerCase()||!['FRESH','COLD_FALLBACK'].includes(record.source))throw new Error('PUBLICATION_RECORD');
   if(record.open&&!validReceipt(record.open)||record.close&&!validReceipt(record.close)||record.cast&&!validReceipt(record.cast))throw new Error('PUBLICATION_RECEIPT');
   if(['CLOSED','COMPLETE'].includes(record.status)&&!record.close||record.status==='COMPLETE'&&!record.cast)throw new Error('PUBLICATION_RECEIPT');
   if(!record.open||!record.publishedAt||!['PUBLISHED','CLOSED','COMPLETE'].includes(record.status)||record.opensAt>Date.now()/1000){records.push(record);continue;}
   if(Date.parse(record.publishedAt)>Date.now()||Date.parse(record.publishedAt)/1000<record.opensAt||!Number.isFinite(Date.parse(record.publishedAt))||record.open.status!=='success'||record.open.chainId!==143||record.open.address.toLowerCase()!==record.contract.toLowerCase()||Date.parse(record.publishedAt)/1000<record.open.timestamp)throw new Error('PUBLICATION_RECEIPT');
   if(record.close&&(record.closesAt>Date.now()/1000||record.close.timestamp<record.closesAt||record.close.status!=='success'))throw new Error('PUBLICATION_CLOSE');
   if(record.cast&&(!record.close||BigInt(record.cast.blockNumber)<BigInt(record.close.blockNumber)||record.cast.timestamp<record.close.timestamp))throw new Error('PUBLICATION_CAST');
   vault??=await localVault(join(root,'runs/publication-vault'),keyFile);
   const draft=await vault.load(record.id);
   if(draft.public.answerHash!==record.answerHash||validateCase(draft).length)throw new Error('PUBLICATION_HASH');
   draft.public.publication={kind:record.kind,day:record.day,opensAt:record.opensAt,closesAt:record.closesAt,contract:record.contract,openTx:record.open.hash,closeTx:record.close?.hash??null,closed:!!record.close};
   records.push(record);drafts.push(draft);
  }catch{
   errors.push({caseId:file.slice(0,-5),code:'PUBLICATION_RECORD_INVALID'});
  }
 }
 return {records,drafts,errors};
}
