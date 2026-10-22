import type {Metadata} from '../../cases/src/build.mts';
export type EyesPower='XRAY'|'ANALYST'|'TAKES_ONE'|'EMPATH';
const shifty=new Set(['side eye','smirk','thug','mog','clown eye','clown eye mix']);
const crude=/boob|milf|retard|horny|boner|\bbbc\b|thots|buttcoin/i;
export function cleanTrait(type:string,value:string){
 const safe=!crude.test(value);
 return {display:safe?value:type==='Head'?'Slogan cap':type==='Body'?'Novelty outfit':'Novelty detail',persona:safe?value:type==='Head'?'a cap with a slogan':type==='Body'?'a novelty outfit':'a novelty detail',safe};
}
export function traitsFor(tokenId:number,metadata:Metadata){
 const attr=(name:string)=>metadata.attributes.find(item=>item.trait_type===name)?.value.toLowerCase()??'';
 const eyes=attr('Eyes'),tier=attr('Tier');
 const power:EyesPower=['fire laser','purple laser','green laser','cyan laser'].includes(eyes)||attr('Head')==='blue laser'?'XRAY':
  ['anime glass','retro glass','3d glass','btc glass','gradient visor','sunset visor','plasma visor','classic vr','modern vr'].includes(eyes)?'ANALYST':shifty.has(eyes)?'TAKES_ONE':'EMPATH';
 const uses=power==='TAKES_ONE'||power==='EMPATH'?1:tier==='legendary'?3:['rare','epic'].includes(tier)?2:1;
 const special=attr('Form')==='skull'||['radioactive','1:1'].includes(attr('Base'));
 return {tokenId,name:metadata.name,power,uses,special,moneyTalk:['gold tooth','btc coin','mon coin'].includes(attr('Mouth')),side:attr('Side')==='right'?'BUYER' as const:'SELLER' as const,
  voice:({XRAY:'sharp',ANALYST:'cool',TAKES_ONE:'nervous',EMPATH:'dreamy'} as const)[power],
  cleanTraits:metadata.attributes.map(item=>({type:item.trait_type,...cleanTrait(item.trait_type,item.value)})),
 };
}
export function traitDictionary(metadata:ReadonlyMap<number,Metadata>){
 const values=new Map<string,{type:string;raw:string;display:string;persona:string;safe:boolean}>();
 for(const item of metadata.values())for(const trait of item.attributes)values.set(`${trait.trait_type}:${trait.value}`,{type:trait.trait_type,raw:trait.value,...cleanTrait(trait.trait_type,trait.value)});
 return {review:'PENDING_USER_REVIEW',values:[...values.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.raw.localeCompare(b.raw))};
}
