import type {Metadata} from '../../cases/src/build.mts';
import {traitsFor} from './traits.mts';
import config from '../../../config/cases.json' with {type:'json'};

export type DetectiveSkill='XRAY'|'ANALYST'|'TAKES_ONE'|'EMPATH'|'LEGEND';
const skillNames:Record<DetectiveSkill,string>={XRAY:'X-ray',ANALYST:'Analyst',TAKES_ONE:'Takes One',EMPATH:'Empath',LEGEND:'Legend'};
const tierUses:Record<string,number>={common:1,uncommon:1,rare:2,epic:2,legendary:3};
export class DetectiveDataError extends Error {
 constructor(public readonly code:string,message:string){super(message);}
}
export function detectiveFor(tokenId:number,metadata:Metadata){
 if(!Number.isSafeInteger(tokenId)||tokenId<1||tokenId>1969)throw new DetectiveDataError('DETECTIVE_TOKEN_INVALID','Chog token id is outside the collection.');
 if(typeof metadata?.name!=='string'||!metadata.name.trim()||metadata.name.length>80||!Array.isArray(metadata.attributes)||metadata.attributes.length<2||metadata.attributes.length>32)throw new DetectiveDataError('DETECTIVE_METADATA_MISSING','Chog name or attributes are missing or invalid.');
 const attributes=new Map<string,string>();
 for(const item of metadata.attributes){
  if(!item||typeof item.trait_type!=='string'||!item.trait_type.trim()||item.trait_type.length>32||typeof item.value!=='string'||!item.value.trim()||item.value.length>128||attributes.has(item.trait_type))throw new DetectiveDataError('DETECTIVE_TRAIT_INVALID','Chog traits are malformed or repeated.');
  attributes.set(item.trait_type,item.value.toLowerCase());
 }
 const base=attributes.get('Base'),tier=attributes.get('Tier');
 if(!base||!['origin','skull','radioactive','1:1'].includes(base))throw new DetectiveDataError('DETECTIVE_BASE_MISSING','Chog Base is missing or unsupported.');
 if(!tier||!Object.hasOwn(tierUses,tier))throw new DetectiveDataError('DETECTIVE_TIER_MISSING','Chog Tier is missing or unsupported.');
 if(base==='1:1'&&tier!=='legendary')throw new DetectiveDataError('DETECTIVE_LEGEND_INVALID','A one-of-one Chog has an inconsistent Tier.');
 if(base!=='1:1'&&!attributes.has('Eyes'))throw new DetectiveDataError('DETECTIVE_EYES_MISSING','A Chog without a Legend skill is missing its Eyes trait.');
 const existing=traitsFor(tokenId,metadata),skill:DetectiveSkill=base==='1:1'?'LEGEND':existing.power;
 const rawSide=attributes.get('Side');
 if(base!=='1:1'&&rawSide===undefined)throw new DetectiveDataError('DETECTIVE_SIDE_MISSING','Chog Side is missing.');
 if(rawSide!==undefined&&!['right','left'].includes(rawSide))throw new DetectiveDataError('DETECTIVE_SIDE_INVALID','Chog Side is unsupported.');
 const side=rawSide==='right'?'BUYER' as const:rawSide==='left'?'SELLER' as const:null;
 return {tokenId,name:metadata.name,skill,skillName:skillNames[skill],uses:tierUses[tier]!,
  moneyTalk:existing.moneyTalk,side,special:base==='skull'||base==='radioactive'||attributes.get('Form')==='skull',
  cleanTraits:existing.cleanTraits,
  skillLine:({XRAY:'Open a sealed receipt free.',ANALYST:'Highlight the receipts that matter to one statement.',TAKES_ONE:'Point out a lying witness.',EMPATH:'+2 questions.',LEGEND:'Open a sealed receipt and point out a lying witness.'} satisfies Record<DetectiveSkill,string>)[skill]};
}
export function questionBudget(input:{skill:DetectiveSkill;heldSince:number;now:number;founder:boolean;firstCase:boolean}){
 const {skill,heldSince,now,founder,firstCase}=input;
 if(!Object.hasOwn(skillNames,skill)||!Number.isSafeInteger(heldSince)||!Number.isSafeInteger(now)||heldSince<0||now<heldSince||typeof founder!=='boolean'||typeof firstCase!=='boolean')throw new DetectiveDataError('DETECTIVE_BUDGET_INPUT','Question budget inputs are missing or invalid.');
 const rules=config.detectiveBudget,holdSeconds=now-heldSince,holdBonus=(holdSeconds>=7*86400?rules.holdSevenDays:0)+(holdSeconds>=30*86400?rules.holdThirtyDays:0);
 const founderBonus=founder?rules.founder:0,empathBonus=skill==='EMPATH'?rules.empath:0,firstCaseBonus=firstCase?rules.firstCase:0;
 return {total:rules.base+holdBonus+founderBonus+empathBonus+firstCaseBonus,base:rules.base,holdBonus,founderBonus,empathBonus,firstCaseBonus,holdSeconds};
}
export function rookieQuestionBudget(skill:DetectiveSkill){
 if(!Object.hasOwn(skillNames,skill))throw new DetectiveDataError('DETECTIVE_SKILL_INVALID','The bureau badge skill is missing or unsupported.');
 const rules=config.detectiveBudget,empathBonus=skill==='EMPATH'?rules.empath:0;
 return {total:rules.base+empathBonus+rules.firstCase,base:rules.base,empathBonus,firstCaseBonus:rules.firstCase,holdBonus:0,founderBonus:0};
}
