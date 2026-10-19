import {test,expect} from 'vitest';
import {createPlayer,recordResult,playerSummary} from '../src/progress.mts';
import {createSession} from '../src/session.mts';
import {draft,partner} from './fixture.mts';
const partners=[partner,{...partner,tokenId:2,power:'ANALYST' as const},{...partner,tokenId:3,power:'EMPATH' as const}];
const result={score:450,grade:'A',questions:[{id:'chog',correct:true},{id:'price',correct:true},{id:'hold',correct:true}]};
function completed(day:string){const next=structuredClone(draft);next.public.id=day+'-main';const session=createSession(next,partner);session.submitted=next.private.key.answers;session.caught=true;session.asked=[next.public.subject.tokenId];return {next,session};}
test('guest starters are stable for an identifier and cover three distinct power groups',()=>{
 const one=createPlayer('fixture',partners);expect(createPlayer('fixture',partners).starters).toEqual(one.starters);expect(new Set(one.starters).size).toBe(3);
});
test('archive completion recruits witnesses without earning a daily streak',()=>{
 const player=createPlayer('fixture',partners),{next,session}=completed('2026-10-18');
 const updated=recordResult(player,next,session,result);
 expect(updated.streak).toBe(0);expect(updated.unlocked).toContain(next.private.key.lie.witness);expect(updated.unlocked).toContain(next.public.subject.tokenId);
 expect(recordResult(updated,next,session,result).results).toHaveLength(1);
});
test('seven consecutive UTC daily solves earn one freeze and replay cannot earn it twice',()=>{
 let player=createPlayer('fixture',partners);
 for(let number=1;number<=7;number++){const day=`2026-10-${String(number).padStart(2,'0')}`,{next,session}=completed(day);player=recordResult(player,next,session,result,'MAIN',day);}
 expect(player.streak).toBe(7);expect(player.alibis).toBe(1);
 const {next,session}=completed('2026-10-07');expect(recordResult(player,next,session,result,'MAIN','2026-10-07').alibis).toBe(1);
 const later=completed('2026-10-09');player=recordResult(player,later.next,later.session,result,'MAIN','2026-10-09');expect(player.streak).toBe(8);expect(player.alibis).toBe(0);
});
test('a missed day without an alibi resets the streak and ranks count unique solved files',()=>{
 let player=createPlayer('fixture',partners);for(const day of ['2026-10-01','2026-10-03','2026-10-04']){const {next,session}=completed(day);player=recordResult(player,next,session,result,'MAIN',day);}
 expect(player.streak).toBe(2);expect(playerSummary(player,partners,'2026-10-05').rank).toBe('Gumshoe');expect(playerSummary(player,partners,'2026-10-08').streak).toBe(0);
});
