import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {EnrichedEvent} from '../../../packages/core/src/enrich.mts';
import type {DeskData} from '../../../packages/detector/src/desk.mts';
export interface PublicContext {history:EnrichedEvent[];times:Map<number,number>;toBlockExclusive:number;coverageAt:number;desk:DeskData|null}
export async function publicContext(root:string,history:EnrichedEvent[],times:Map<number,number>,toBlockExclusive:number,coverageAt=Math.max(...times.values())):Promise<PublicContext>{
 let desk:DeskData|null=null;
 for(const path of ['data/wallet-records','runs/wallet-records-20261017']){
  try{
   const [assessments,wallets,scope]=await Promise.all(['assessments.json','wallets.json','report.json'].map(file=>readFile(join(root,path,file),'utf8')));
   const parsed=JSON.parse(assessments!);desk={...parsed,wallets:JSON.parse(wallets!),scope:JSON.parse(scope!)};break;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 return {history,times,toBlockExclusive,coverageAt,desk};
}
