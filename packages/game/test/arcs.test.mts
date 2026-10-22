import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {test,expect} from 'vitest';
import config from '../../../config/cases.json' with {type:'json'};
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import {saleCandidates} from '../../cases/src/select.mts';
import {currentArc,movesOf,caseHook,hunchResult,HunchDesk} from '../src/arcs.mts';

// Real records: CHOG token 1021 changes wallets again and again.
const trail=JSON.parse(readFileSync(new URL('../../cases/test/fixtures/chog-trail.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const times=new Map(trail.times),moves=movesOf(trail.rows,times,1021);

test('the Chog that keeps moving becomes the story, with its real moves newest last',()=>{
 expect(moves.length).toBeGreaterThan(10);
 for(let index=1;index<moves.length;index++)expect(moves[index]!.block>=moves[index-1]!.block).toBe(true);
 const at=moves.at(-1)!.at,arc=currentArc(trail.rows,times,at)!;
 expect(arc.tokenId).toBe(1021);expect(arc.moves.length).toBeGreaterThanOrEqual(3);expect(arc.moves.every(row=>row.at>=at-7*86400&&row.at<=at)).toBe(true);
 expect(currentArc(trail.rows,times,moves[0]!.at-30*86400)).toBeNull();
});

test('a closed case ends on the subject’s next real move, and a hunch resolves from the chain',()=>{
 const earlier=moves.at(-3)!,next=moves.at(-2)!,hook=caseHook(trail.rows,times,1021,earlier.block,next.at)!;
 expect(hook.source).toEqual({tx:next.tx,block:next.block,logIndex:next.logIndex});expect(hook.text).toMatch(/^It .+ again at \d\d:\d\d UTC…$/);
 expect(caseHook(trail.rows,times,1021,earlier.block,earlier.at)).toBeNull();
 const day=new Date(next.at*1000).toISOString().slice(0,10);expect(hunchResult(moves,day)).toBe('yes');expect(hunchResult(moves,'2026-01-01')).toBe('no');
});

test('a sale after two moves in the same week is part of an ongoing story',()=>{
 const sales=saleCandidates(trail.rows,times,config).filter(row=>row.row.event.tokenId===1021);
 const story=sales.filter(row=>row.type==='PING_PONG');expect(story.length).toBeGreaterThan(0);
 for(const row of story)expect(moves.filter(move=>move.block<row.row.event.block&&move.at>=row.at-7*86400).length).toBeGreaterThanOrEqual(2);
});

test('one hunch per browser per day, counted anonymously',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-hunch-'));
 try{
  const desk=new HunchDesk(root),first=randomBytes(32).toString('hex'),second=randomBytes(32).toString('hex');
  expect(await desk.cast(1021,'2026-10-22',first,'yes')).toEqual({yes:1,no:0,mine:'yes'});
  expect(await desk.cast(1021,'2026-10-22',first,'no')).toEqual({yes:1,no:0,mine:'yes'});
  expect(await desk.cast(1021,'2026-10-22',second,'no')).toEqual({yes:1,no:1,mine:'no'});
  expect(await desk.tally(1021,'2026-10-22')).toEqual({yes:1,no:1,mine:null});
  await expect(desk.cast(1021,'2026-10-22','not-a-voter','yes')).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
