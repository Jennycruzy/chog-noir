import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,expect} from 'vitest';
import {CareerStore,careerRank,careerStatus,type DetectiveResult} from '../src/store.mts';
const wallet='0x285074ee7a7ae5e0a2188949fe6bd71de25492b7';
const buyer='0x8041113dd804725e235d32aa2e85920d6af32428';
const result=(day:string):DetectiveResult=>({caseId:'daily-'+day,day,grade:'A',score:600,perfect:true,caught:[11,11],transferredMidCase:false});
async function sandbox(action:(root:string,store:CareerStore)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'chog-career-'));try{await action(root,new CareerStore(root));}finally{await rm(root,{recursive:true,force:true});}}
async function complete(store:CareerStore,day:string,founder=false){const row=result(day);await store.start({mode:'HOLDER',tokenId:1,wallet,caseId:row.caseId,day,now:Date.parse(day)});return store.finish({mode:'HOLDER',tokenId:1,wallet,founder,result:row});}
test('one duty per token per day survives restart and sale; a transferred finish stays on the token',async()=>sandbox(async(root,store)=>{
 const row=result('2026-10-01'),input={mode:'HOLDER' as const,tokenId:1,wallet,caseId:row.caseId,day:row.day,now:Date.parse(row.day)};
 const starts=await Promise.all([store.start(input),new CareerStore(root).start(input)]);
 expect(starts.filter(row=>row.resumed)).toHaveLength(1);
 await expect(store.start({...input,wallet:buyer})).rejects.toMatchObject({code:'PLAY_ALREADY_TODAY'});
 row.transferredMidCase=true;
 const finished=await store.finish({mode:'HOLDER',tokenId:1,wallet,founder:false,result:row});
 expect(finished).toMatchObject({solves:1,liesCaught:2,perfectCases:1,gallery:[11],streak:1});
 expect(finished.duties[0]?.result?.transferredMidCase).toBe(true);
 expect(await new CareerStore(root).finish({mode:'HOLDER',tokenId:1,wallet,founder:false,result:row})).toEqual(finished);
 await expect(store.start(input)).rejects.toMatchObject({code:'PLAY_ALREADY_TODAY'});
 const next=result('2026-10-02');await store.start({...input,wallet:buyer,caseId:next.caseId,day:next.day});
 const sold=await store.finish({mode:'HOLDER',tokenId:1,wallet:buyer,founder:false,result:next});
 expect(sold.solves).toBe(2);expect(sold.streak).toBe(2);expect(sold.gallery).toEqual([11]);
}));
test('rookie calls leave storage completely empty',async()=>sandbox(async(root,store)=>{
 await expect(store.start({mode:'ROOKIE' as 'HOLDER',tokenId:1,wallet,caseId:'daily',day:'2026-10-01',now:0})).rejects.toMatchObject({code:'CAREER_HOLDER_REQUIRED'});
 await expect(store.finish({mode:'ROOKIE' as 'HOLDER',tokenId:1,wallet,founder:false,result:result('2026-10-01')})).rejects.toMatchObject({code:'CAREER_HOLDER_REQUIRED'});
 expect(await readdir(root)).toEqual([]);
}));
test('seven-day streak earns a freeze, a missed day consumes it, another missed day breaks the streak',async()=>sandbox(async(_root,store)=>{
 for(let day=1;day<=7;day++)await complete(store,`2026-10-0${day}`);
 expect(await store.profile(1)).toMatchObject({streak:7,bestStreak:7,freezes:1});
 const before=await store.profile(1);
 expect(careerStatus(before,'2026-10-09',false)).toMatchObject({streak:7,freezes:0});
 expect(await store.profile(1)).toEqual(before);
 expect(await complete(store,'2026-10-09')).toMatchObject({streak:8,bestStreak:8,freezes:0});
 expect(await complete(store,'2026-10-11')).toMatchObject({streak:1,bestStreak:8,freezes:0});
}));
test('Founder weekly freezes cap at two and ranks depend on solved cases',async()=>sandbox(async(_root,store)=>{
 expect(await complete(store,'2026-10-04',true)).toMatchObject({freezes:1,streak:1});
 expect(await complete(store,'2026-10-05',true)).toMatchObject({freezes:2,streak:2});
 expect(await complete(store,'2026-10-06',true)).toMatchObject({freezes:2,streak:3});
 expect([0,3,10,25,50].map(careerRank)).toEqual(['Rookie','Gumshoe','Detective','Inspector','Chief']);
}));
test('an unsolved submitted case keeps its streak but does not increase solved rank',async()=>sandbox(async(root,store)=>{
 const row=result('2026-10-01');row.grade='D';row.score=0;row.perfect=false;row.caught=[];
 await store.start({mode:'HOLDER',tokenId:1,wallet,caseId:row.caseId,day:row.day,now:Date.parse(row.day)});
 expect(await store.finish({mode:'HOLDER',tokenId:1,wallet,founder:false,result:row})).toMatchObject({solves:0,streak:1,perfectCases:0,grades:{D:1},gallery:[]});
 await writeFile(join(root,'runs/career/1.json'),JSON.stringify({v:2,tokenId:1,duties:[]}));
 await expect(store.profile(1)).rejects.toMatchObject({code:'CAREER_STORAGE_INVALID'});
}));
