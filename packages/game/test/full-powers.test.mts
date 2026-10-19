import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {draft as baseline,partner} from './fixture.mts';
import {createSession,play,viewSession,type Session} from '../src/session.mts';
import {buildMemories} from '../../witness/src/facts.mts';
import {cards} from '../../witness/src/lines.mts';
import type {Metadata} from '../../cases/src/build.mts';
import type {EnrichedEvent} from '../../core/src/enrich.mts';
const fixture=JSON.parse(await readFile(new URL('../../cases/test/fixtures/sales.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const saved=JSON.parse(await readFile(new URL('../../cases/test/fixtures/metadata.json',import.meta.url),'utf8')) as Record<string,Metadata>;
const metadata=new Map(Object.entries(saved).map(([id,item])=>[Number(id),item]));
const draft=structuredClone(baseline);draft.private.facts=buildMemories(draft,fixture.rows,new Map(fixture.times),metadata);
const act=(session:Session,input:Record<string,unknown>)=>play(draft,session,{revision:session.revision,...input});
test('ten distinct card plays are charged independently, with free rereads',()=>{
 let session=createSession(draft,{...partner,power:'EMPATH'});
 for(const card of cards)session=act(session,{type:'ask',tokenId:draft.public.subject.tokenId,card});
 expect(session.plays).toBe(0);expect(session.askedCards).toHaveLength(10);expect(session.asked).toHaveLength(1);
 expect(act(session,{type:'ask',tokenId:draft.public.subject.tokenId,card:'PRICE_TALK'}).plays).toBe(0);
 expect(viewSession(draft,session).testimony).toHaveLength(10);
});
test('Money Talk exposes exact supported prices without an Analyst use',()=>{
 let session=createSession(draft,{...partner,power:'EMPATH',moneyTalk:true});session=act(session,{type:'ask',tokenId:draft.public.subject.tokenId,card:'PRICE_TALK'});
 const line=viewSession(draft,session).testimony[0]!;expect(line.exact).toBe(true);expect(line.line).toContain(draft.private.facts![draft.public.subject.tokenId]!.cards.PRICE_TALK.exactDetail!);
});
test('Analyst upgrades a witnessed price while keeping the raw memory sheet private',()=>{
 let session=createSession(draft,{...partner,power:'ANALYST',uses:2});session=act(session,{type:'ask',tokenId:draft.public.subject.tokenId,card:'PRICE_TALK'});
 expect(viewSession(draft,session).testimony[0]!.exact).toBe(false);
 session=act(session,{type:'power',tokenId:draft.public.subject.tokenId});expect(session.powerUses).toBe(1);expect(session.powerUsed).toBe(false);expect(viewSession(draft,session).testimony[0]!.exact).toBe(true);
 expect(()=>act(session,{type:'power',tokenId:draft.public.subject.tokenId})).toThrow('already available');
});
test('X-ray has tier-based uses rather than a single boolean allowance',()=>{
 let session=createSession(draft,{...partner,uses:2});
 for(const fact of draft.public.ledger.filter(item=>item.sealed))session=act(session,{type:'power',factId:fact.id});
 expect(session.powerUses).toBe(0);expect(session.powerUsed).toBe(true);expect(session.plays).toBe(8);
});
test('buyer-side free play is applied once and a special partner gets one additional card',()=>{
 let session=createSession(draft,{...partner,side:'BUYER',special:true});expect(session.initialPlays).toBe(9);
 session=act(session,{type:'ask',tokenId:draft.public.subject.tokenId,card:'ARRIVAL'});expect(session.plays).toBe(9);expect(session.sideUsed).toBe(true);
 session=act(session,{type:'ask',tokenId:draft.public.subject.tokenId,card:'PRICE_TALK'});expect(session.plays).toBe(8);
});
test('Takes one to know one identifies a witness but reveals no key, salt or card',()=>{
 const session=act(createSession(draft,{...partner,power:'TAKES_ONE'}),{type:'power'}),view=viewSession(draft,session);
 expect(view.identified).toBe(draft.private.key.lie.witness);expect(view.testimony).toHaveLength(0);expect(view.result).toBe(null);expect(JSON.stringify(view)).not.toContain('"salt"');
});
test('testimony never serializes the hidden source memory or planned-lie flags',()=>{
 const session=act(createSession(draft,partner),{type:'ask',tokenId:draft.private.key.lie.witness,card:draft.private.key.lie.card});
 const line=viewSession(draft,session).testimony[0]!;expect(line).not.toHaveProperty('sources');expect(line).not.toHaveProperty('isLie');expect(line).not.toHaveProperty('trueFacts');
});
test('a personally submitted daily case cannot reveal its salt before chain close',()=>{
 const daily=structuredClone(draft);daily.public.publication={kind:'MAIN',day:'2026-10-18',opensAt:1,closesAt:4_000_000_000,openTx:'0x'+'12'.repeat(32),closeTx:null,contract:'0x'+'34'.repeat(20),closed:false};
 let session=createSession(daily,partner);session=play(daily,session,{revision:0,type:'submit',answers:daily.private.key.answers});
 const before=viewSession(daily,session);expect(before.result).toBe(null);expect(before.locked).toBe(true);expect(before.ledger.filter(item=>item.sealed).length).toBeGreaterThan(0);
 daily.public.publication.closed=true;expect(viewSession(daily,session).result!.verification.salt).toBe(daily.private.salt);
});
