import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import {keccak256,toBytes} from 'viem';
import config from '../../../config/cases.json' with {type:'json'};
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import type {OwnerSnapshot} from '../../auth/src/holders.mts';
import {buildCast,buildLinkedCast,canonicalJSON,type Metadata} from '../src/build.mts';
import {saleCandidates} from '../src/select.mts';
import {buildSalePuzzle,validatePuzzle,puzzleHash,planFor} from '../src/puzzle.mts';
import {catalogForPuzzle,composePuzzle,selectClaimPuzzle,verifyComposedPuzzleSources} from '../src/compose.mts';
import {createPuzzleSession,viewPuzzleSession} from '../../game/src/puzzle-session.mts';

const fixture=JSON.parse(readFileSync(new URL('../../game/test/fixtures/puzzle-sale.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const {snapshot:ownership}=JSON.parse(readFileSync(new URL('../../auth/test/fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot};
const {tokens}=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata}[]};
const metadata=new Map(tokens.map(row=>[row.tokenId,row.metadata])),times=new Map(fixture.times),candidate=saleCandidates(fixture.rows,times,config).reverse().find(row=>buildCast(row,fixture.rows,times,metadata).length>=4)!;
const after=new Date((candidate.at+7*86400)*1000);after.setUTCDate(after.getUTCDate()+(8-after.getUTCDay())%7);const monday=Date.parse(after.toISOString().slice(0,10)+'T00:00:00Z');
const input=(offset=0)=>({candidate,history:fixture.rows,times,metadata,day:new Date(monday+offset*86400000).toISOString().slice(0,10),salt:'0x'+'b4'.repeat(32),mode:'REPLAY' as const});
const build=(offset=0)=>{const source=input(offset),base=buildSalePuzzle(source),catalog=catalogForPuzzle(base,{history:source.history,times,metadata,ownership});return {source,base,catalog};};

test('varied claims preserve every weekday pattern, own-Chog alternate and minimum-budget solver result',()=>{
 for(let day=0;day<7;day++){
  const {source,base,catalog}=build(day),{puzzle,proof}=selectClaimPuzzle(base,catalog);
  expect(validatePuzzle(puzzle)).toEqual([]);expect(verifyComposedPuzzleSources(puzzle,source,catalog)).toBe(true);expect(proof).toHaveLength((base.file.cast.length+1)*5);expect(proof.every(row=>row.questionsSpent<=3&&row.questionsLeft>=1)).toBe(true);
  expect(puzzle.file.receipts.length).toBeGreaterThanOrEqual(4);expect(puzzle.file.receipts.length).toBeLessThanOrEqual(6);
  for(const member of puzzle.file.cast)expect(puzzle.file.receipts.some(row=>row.tokenIds?.includes(member.tokenId))).toBe(true);
  expect(planFor(puzzle,null).lies[0]!.kind.startsWith('D')).toBe(true);expect(planFor(puzzle,null).lies[1]!.kind.startsWith('I')).toBe(true);
  for(const member of puzzle.file.cast)expect(planFor(puzzle,member.tokenId).lies.some(row=>row.witness===member.tokenId)).toBe(false);
 }
});
test('specified owner-count and paid-purchase claims become one precise breaking receipt each',()=>{
 const {base,catalog}=build(2),{puzzle}=selectClaimPuzzle(base,catalog,{A:'D3',B:'I1'});
 expect(planFor(puzzle,null).lies.map(row=>row.kind)).toEqual(['D3','I1']);
 for(const lie of planFor(puzzle,null).lies){const statement=planFor(puzzle,null).statements.find(row=>row.id===lie.statementId)!;const proofs=puzzle.file.receipts.filter(row=>row.facts.some(fact=>fact.id===statement.claim.factId));expect(proofs).toHaveLength(1);expect(proofs[0]!.id).toBe(lie.receiptId);}
});
test('roommate inference fits the same action engine without adding a question wall',()=>{
 const {base,catalog}=build(5),{puzzle,proof}=selectClaimPuzzle(base,catalog,{B:'I5'});
 expect(planFor(puzzle,null).lies.find(row=>row.id==='B')!.kind).toBe('I5');expect(proof.every(row=>row.questionsLeft>=1)).toBe(true);
});
test('each holder sees its own-Chog banner and a free receipt about that Chog',()=>{
 const {base,catalog}=build(6),{puzzle}=selectClaimPuzzle(base,catalog);
 for(const member of puzzle.file.cast){
  const session=createPuzzleSession(puzzle,{tokenId:member.tokenId,name:member.name,skill:'XRAY',uses:1,questions:6,moneyTalk:false,side:null,freePress:[]},'HOLDER');
  expect(viewPuzzleSession(puzzle,session).ownChogMessage).toBe("Your Chog is in today's case.");expect(puzzle.file.receipts.some(row=>row.tokenIds?.includes(member.tokenId)&&session.opened.includes(row.id))).toBe(true);
 }
});
test('unproven selections and changed receipt text cannot pass source verification',()=>{
 const {source,base,catalog}=build(),{puzzle,candidates}=selectClaimPuzzle(base,catalog);
 expect(()=>composePuzzle(base,candidates,{A:'missing',B:'missing'})).toThrow('proven claim');
 puzzle.file.receipts[0]!.text+=' An extra claim.';puzzle.key.contentHash=keccak256(toBytes(canonicalJSON(puzzle.file)));puzzle.answerHash=puzzleHash(puzzle);
 expect(validatePuzzle(puzzle)).toEqual([]);expect(verifyComposedPuzzleSources(puzzle,source,catalog)).toBe(false);
});
test('a catalogue from another cutoff cannot supply the case claims',()=>{
 const {base,catalog}=build();base.file.cutoff.logIndex++;
 expect(()=>selectClaimPuzzle(base,catalog)).toThrow('case cutoff');
});

test('witness cast contains recorded event connections and never fills gaps with nearby token numbers',()=>{
 const source=input(),cast=buildLinkedCast(candidate,source.history,times,metadata);
 expect(cast.length).toBeGreaterThanOrEqual(3);expect(cast.some(row=>row.role==='NEIGHBOUR')).toBe(false);
 const before=source.history.filter(row=>row.event.block<candidate.row.event.block||row.event.block===candidate.row.event.block&&row.event.logIndex<=candidate.row.event.logIndex);
 for(const member of cast){
  if(member.role==='SUBJECT')expect(member.tokenId).toBe(candidate.row.event.tokenId);
  else if(member.role==='PREVIOUS_ROOMMATE'){
   const formerOwners=new Set(before.filter(row=>row.event.tokenId===candidate.row.event.tokenId).map(row=>row.event.from));
   const arrival=before.find(row=>row.event.tx===member.arrival.tx&&row.event.logIndex===member.arrival.logIndex)!;
   expect(before.some(row=>row.event.tokenId===member.tokenId&&row.event.to===candidate.row.event.from)||formerOwners.has(arrival.event.to)).toBe(true);
  }
  else if(member.role==='RECENT_SALE')expect(before.some(row=>row.event.tokenId===member.tokenId&&row.event.class==='SALE'&&times.get(row.event.block)!>=candidate.at-6*3600)).toBe(true);
  else{const arrival=before.find(row=>row.event.tx===member.arrival.tx&&row.event.logIndex===member.arrival.logIndex)!;expect(arrival.event.to).toBe(member.role==='SELLER_ROOMMATE'?candidate.row.event.from:candidate.row.event.to);}
 }
 const isolated=source.history.filter(row=>row.event.tokenId===candidate.row.event.tokenId);
 expect(buildLinkedCast(candidate,isolated,times,metadata)).toHaveLength(1);
 expect(()=>buildSalePuzzle({...source,history:isolated})).toThrow('eligible witnesses');
});
