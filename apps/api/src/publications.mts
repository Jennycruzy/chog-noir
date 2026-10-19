import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {localVault} from '../../../packages/publishing/src/vault.mts';
import type {Publication} from '../../../packages/publishing/src/publish.mts';
import {validateCase,type CaseDraft} from '../../../packages/cases/src/build.mts';
export async function publishedCases(root:string){
 const records:Publication[]=[],drafts:CaseDraft[]=[];
 let files:string[];try{files=await readdir(join(root,'runs/publications'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {records,drafts};throw error;}
 const vault=await localVault(join(root,'runs/publication-vault'));
 for(const file of files.filter(file=>/^\d{4}-\d{2}-\d{2}-(main|cold)\.json$/.test(file))){
  const record=JSON.parse(await readFile(join(root,'runs/publications',file),'utf8')) as Publication;
  records.push(record);
  if(!record.open||!record.publishedAt||!['PUBLISHED','CLOSED','COMPLETE'].includes(record.status)||record.opensAt>Date.now()/1000)continue;
  const draft=await vault.load(record.id);
  if(draft.public.answerHash!==record.answerHash||validateCase(draft).length)throw new Error('PUBLICATION_HASH: Saved case differs from its confirmed commitment');
  draft.public.publication={kind:record.kind,day:record.day,opensAt:record.opensAt,closesAt:record.closesAt,contract:record.contract,openTx:record.open.hash,closeTx:record.close?.hash??null,closed:!!record.close};
  drafts.push(draft);
 }
 return {records,drafts};
}
