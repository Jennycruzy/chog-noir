import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Metadata} from '../../../packages/cases/src/build.mts';
import type {EnrichedEvent} from '../../../packages/core/src/enrich.mts';
import type {DeskData} from '../../../packages/detector/src/desk.mts';
import {traitsFor} from '../../../packages/traits/src/traits.mts';
export interface PublicContext {profiles:Map<number,ReturnType<typeof traitsFor>>;history:EnrichedEvent[];times:Map<number,number>;toBlockExclusive:number;coverageAt:number;desk:DeskData|null}
export async function publicContext(root:string,metadata:Map<number,Metadata>,history:EnrichedEvent[],times:Map<number,number>,toBlockExclusive:number,coverageAt=Math.max(...times.values())):Promise<PublicContext>{
 let desk:DeskData|null=null;
 for(const path of ['data/wallet-records','runs/wallet-records-20261017']){
  try{
   const [assessments,wallets,scope]=await Promise.all(['assessments.json','wallets.json','report.json'].map(file=>readFile(join(root,path,file),'utf8')));
   const parsed=JSON.parse(assessments!);desk={...parsed,wallets:JSON.parse(wallets!),scope:JSON.parse(scope!)};break;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 return {profiles:new Map([...metadata].map(([id,item])=>[id,traitsFor(id,item)])),history,times,toBlockExclusive,coverageAt,desk};
}
