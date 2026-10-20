import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import {detectiveFor,questionBudget,rookieQuestionBudget} from '../src/detective.mts';
import type {Metadata} from '../../cases/src/build.mts';

const collection=JSON.parse(readFileSync(new URL('./fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata;expectedSkill:string}[]};
test('every stored Chog has one skill; one-of-ones receive Legend instead of Empath',()=>{
 expect(collection.tokens).toHaveLength(1969);
 expect(new Set(collection.tokens.map(row=>row.tokenId)).size).toBe(1969);
 const counts:Record<string,number>={};
 for(const row of collection.tokens){
  const detective=detectiveFor(row.tokenId,row.metadata);
  expect(detective.skill).toBe(row.expectedSkill);
  expect(detective.name).toBe(row.metadata.name);
  counts[detective.skill]=(counts[detective.skill]??0)+1;
  const tier=row.metadata.attributes.find(a=>a.trait_type==='Tier')!.value;
  expect(detective.uses).toBe(({Common:1,Uncommon:1,Rare:2,Epic:2,Legendary:3} as Record<string,number>)[tier]);
  if(detective.skill==='LEGEND'){expect(detective.side).toBeNull();expect(detective.special).toBe(false);}
 }
 expect(counts).toEqual({XRAY:278,ANALYST:369,TAKES_ONE:234,EMPATH:1078,LEGEND:10});
});
test('hold bonuses start at exact seven-day and thirty-day boundaries',()=>{
 const heldSince=1_800_000_000;
 for(const [seconds,total] of [[0,4],[7*86400-1,4],[7*86400,5],[30*86400-1,5],[30*86400,6]]){
  expect(questionBudget({skill:'ANALYST',heldSince,now:heldSince+seconds!,founder:false,firstCase:false}).total).toBe(total);
 }
 expect(questionBudget({skill:'EMPATH',heldSince,now:heldSince+31*86400,founder:true,firstCase:true})).toMatchObject({total:11,holdBonus:2,founderBonus:1,empathBonus:2,firstCaseBonus:2});
});
test('rookie badges have only base, skill and first-case questions',()=>{
 for(const skill of ['XRAY','ANALYST','TAKES_ONE','EMPATH','LEGEND'] as const){
  expect(rookieQuestionBudget(skill)).toEqual({total:skill==='EMPATH'?8:6,base:4,empathBonus:skill==='EMPATH'?2:0,firstCaseBonus:2,holdBonus:0,founderBonus:0});
 }
});
test('missing or inconsistent detective facts fail instead of assigning defaults',()=>{
 const row=collection.tokens.find(row=>row.metadata.attributes.some(a=>a.trait_type==='Base'&&a.value==='Origin'))!;
 for(const type of ['Base','Tier','Eyes']){
  const metadata=structuredClone(row.metadata);metadata.attributes=metadata.attributes.filter(a=>a.trait_type!==type);
  expect(()=>detectiveFor(row.tokenId,metadata)).toThrow();
 }
 const repeated=structuredClone(row.metadata);repeated.attributes.push(repeated.attributes[0]!);
 expect(()=>detectiveFor(row.tokenId,repeated)).toThrow();
 expect(()=>detectiveFor(0,row.metadata)).toThrow();
 expect(()=>detectiveFor(1970,row.metadata)).toThrow();
 expect(()=>questionBudget({skill:'EMPATH',heldSince:100,now:99,founder:false,firstCase:true})).toThrow();
});
