import {createHash} from 'node:crypto';
import type {Metadata} from '../../cases/src/build.mts';
import {ZERO,type Transfer} from '../../core/src/chain.mts';
import {cleanTrait} from '../../traits/src/traits.mts';
import {detectiveFor} from '../../traits/src/detective.mts';
import {ownerDirectory,type OwnerSnapshot} from './holders.mts';
import type {MetadataRecord} from './roster.mts';
import {AuthError} from './auth.mts';

type Receipt={kind:'TRANSFER';tx:string;block:number;logIndex:number};
type MetadataSource={kind:'METADATA';uri:string;fetchedAt:string};
export type WitnessConnection=
 |{kind:'LOOK';reason:string;traitType:string;traitId:string;holders:number;sources:MetadataSource[]}
 |{kind:'WALLET';reason:string;sources:Receipt[]}
 |{kind:'TRAIL';reason:string;bridge:number;sources:Receipt[]}
 |{kind:'MINT';reason:string;distance:number;sources:Receipt[]};
const looks=new Set(['Head','Eyes','Mouth','Body','Accessory','Aura','Skin','Background']);
/** Owner decision, 22 Oct: looks held by at most 10% of Chogs, mint slots within 50, and one-step wallet trails. */
const RARE_SHARE=0.10,MINT_DISTANCE=50;
const key=(type:string,value:string)=>JSON.stringify([type,value]);
const receipt=(row:Transfer):Receipt=>({kind:'TRANSFER',tx:row.tx,block:row.block,logIndex:row.logIndex});
const metadataSource=(row:MetadataRecord):MetadataSource=>({kind:'METADATA',uri:row.uri,fetchedAt:row.fetchedAt});
const validToken=(id:number)=>Number.isSafeInteger(id)&&id>=1&&id<=1969;
function lookTraits(metadata:Metadata){return metadata.attributes.filter(row=>looks.has(row.trait_type)||row.trait_type==='Base'&&['Skull','Radioactive'].includes(row.value));}

/** Source-backed links at a fixed block; later transfers cannot create earlier friendships. */
export class WitnessConnections {
 private readonly metadata=new Map<number,MetadataRecord>();
 private readonly rarity=new Map<string,Set<number>>();
 private readonly wallets=new Map<number,Map<string,Transfer>>();
 private readonly mint=new Map<number,{position:number;transfer:Transfer}>();
 private readonly residents=new Map<string,Map<number,Transfer>>();
 constructor(options:{snapshot:OwnerSnapshot;metadata:ReadonlyMap<number,MetadataRecord>;atBlock:number}){
  ownerDirectory(options.snapshot);
  if(!Number.isSafeInteger(options.atBlock)||options.atBlock<0||options.atBlock>options.snapshot.indexedBlock||options.metadata.size!==1969)throw new AuthError('CONNECTION_INPUT_INVALID','Witness history could not be checked.',503);
  for(let id=1;id<=1969;id++){
   const record=options.metadata.get(id);
   if(!record||typeof record.uri!=='string'||!record.uri.trim()||!Number.isFinite(Date.parse(record.fetchedAt)))throw new AuthError('CONNECTION_METADATA_MISSING','Witness appearance could not be checked.',503);
   detectiveFor(id,record.metadata);
   const saved=structuredClone(record);this.metadata.set(id,saved);
   for(const trait of lookTraits(saved.metadata)){
    const identity=key(trait.trait_type,trait.value),tokens=this.rarity.get(identity)??new Set<number>();tokens.add(id);this.rarity.set(identity,tokens);
   }
  }
  const transfers=options.snapshot.transfers.filter(row=>row.block<=options.atBlock).sort((a,b)=>a.block-b.block||a.logIndex-b.logIndex);
  let position=0;
  for(const original of transfers){
   const row={...original,from:original.from.toLowerCase(),to:original.to.toLowerCase()};
   if(row.from===ZERO)this.mint.set(row.tokenId,{position:position++,transfer:row});
   if(row.to!==ZERO){const history=this.wallets.get(row.tokenId)??new Map<string,Transfer>();if(!history.has(row.to))history.set(row.to,row);this.wallets.set(row.tokenId,history);
    const resident=this.residents.get(row.to)??new Map<number,Transfer>();if(!resident.has(row.tokenId))resident.set(row.tokenId,row);this.residents.set(row.to,resident);}
  }
  if(this.mint.size!==1969)throw new AuthError('CONNECTION_HISTORY_INCOMPLETE','Witness history predates the full collection.',503);
 }
 between(detectiveId:number,witnessId:number):WitnessConnection[]{
  if(!validToken(detectiveId)||!validToken(witnessId))throw new AuthError('CONNECTION_TOKEN_INVALID','Choose a Chog from the collection.',400);
  if(detectiveId===witnessId)return [];
  const detective=this.metadata.get(detectiveId)!,witness=this.metadata.get(witnessId)!,links:WitnessConnection[]=[];
  const witnessLooks=new Set(lookTraits(witness.metadata).map(row=>key(row.trait_type,row.value)));
  for(const trait of lookTraits(detective.metadata)){
   const identity=key(trait.trait_type,trait.value),holders=this.rarity.get(identity)!.size;
   if(holders/1969>RARE_SHARE||!witnessLooks.has(identity))continue;
   links.push({kind:'LOOK',reason:'same '+cleanTrait(trait.trait_type,trait.value).display,traitType:trait.trait_type,traitId:createHash('sha256').update(identity).digest('hex'),holders,sources:[metadataSource(detective),metadataSource(witness)]});
  }
  const shared=[...this.wallets.get(detectiveId)!].filter(([wallet])=>this.wallets.get(witnessId)!.has(wallet)).sort(([a],[b])=>a.localeCompare(b));
  if(shared.length){const [wallet,arrival]=shared[0]!;links.push({kind:'WALLET',reason:'once lived in the same wallet',sources:[receipt(arrival),receipt(this.wallets.get(witnessId)!.get(wallet)!)]});}
  else{
   // A trail: another Chog lived in a wallet with the detective and in a wallet with the witness. Four arrivals prove it.
   const trail=[...this.wallets.get(detectiveId)!].sort(([a],[b])=>a.localeCompare(b)).flatMap(([first,detectiveArrival])=>
    [...this.residents.get(first)!].filter(([bridge])=>bridge!==detectiveId&&bridge!==witnessId).sort(([a],[b])=>a-b).flatMap(([bridge,bridgeFirst])=>
     [...this.wallets.get(bridge)!].filter(([second])=>second!==first&&this.wallets.get(witnessId)!.has(second)).sort(([a],[b])=>a.localeCompare(b)).map(([second,bridgeSecond])=>({bridge,sources:[receipt(detectiveArrival),receipt(bridgeFirst),receipt(bridgeSecond),receipt(this.wallets.get(witnessId)!.get(second)!)]}))))[0];
   if(trail)links.push({kind:'TRAIL',reason:'shared a wallet with a Chog that lived with this witness',bridge:trail.bridge,sources:trail.sources});
  }
  const first=this.mint.get(detectiveId)!,second=this.mint.get(witnessId)!,distance=Math.abs(first.position-second.position);
  if(distance<=MINT_DISTANCE)links.push({kind:'MINT',reason:distance<=10?'minted minutes apart':'minted close together',distance,sources:[receipt(first.transfer),receipt(second.transfer)]});
  return structuredClone(links);
 }
}
