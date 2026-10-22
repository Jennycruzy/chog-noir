import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import {keccak256,toBytes} from 'viem';
import config from '../../../config/cases.json' with {type:'json'};
import type {EnrichedEvent,Source} from '../../core/src/enrich.mts';
import type {OwnerSnapshot} from '../../auth/src/holders.mts';
import {buildLinkedCast,canonicalJSON,type Metadata} from '../src/build.mts';
import {saleCandidates} from '../src/select.mts';
import {buildSalePuzzle,validatePuzzle,verifySalePuzzleSources,witnessCutoff,puzzleHash,type PuzzleCase} from '../src/puzzle.mts';
import {catalogForPuzzle,selectClaimPuzzle,verifyComposedPuzzleSources} from '../src/compose.mts';

// Archive 4: CHOG token 1931 sold on Sat 3 Oct 13:20 UTC; four other Chogs sold within the next six hours.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/witness-window.json',import.meta.url),'utf8')) as {subjectTx:string;subjectLogIndex:number;day:string;rows:EnrichedEvent[];times:[number,number][]};
const {snapshot:ownership}=JSON.parse(readFileSync(new URL('../../auth/test/fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot};
const {tokens}=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata}[]};
const metadata=new Map(tokens.map(row=>[row.tokenId,row.metadata])),times=new Map(fixture.times),salt='0x'+'c7'.repeat(32);
const candidates=saleCandidates(fixture.rows,times,config);
const saleAt=(tx:string,logIndex:number)=>candidates.find(row=>row.row.event.tx===tx&&row.row.event.logIndex===logIndex)!;
const subject=saleAt(fixture.subjectTx,fixture.subjectLogIndex);
const input=(history:readonly EnrichedEvent[]=fixture.rows,day=fixture.day,candidate=subject)=>({candidate,history,times,metadata,day,salt,mode:'REPLAY' as const});
const at=(row:Source)=>times.get(row.block)!;
const atOrBefore=(row:Source,cutoff:Source)=>row.block<cutoff.block||row.block===cutoff.block&&row.logIndex<=cutoff.logIndex;
const withoutBlocks=(...blocks:number[])=>fixture.rows.filter(row=>!blocks.includes(row.event.block));
const sources=(puzzle:PuzzleCase)=>[...puzzle.file.receipts.flatMap(row=>row.sources),...puzzle.file.tiles.flatMap(row=>row.sources)];
const rehash=(puzzle:PuzzleCase)=>{puzzle.key.contentHash=keccak256(toBytes(canonicalJSON(puzzle.file)));puzzle.answerHash=puzzleHash(puzzle);return puzzle;};

test('a weekend case borrows sales from the six hours after its subject to fill four witnesses',()=>{
 expect(buildLinkedCast(subject,fixture.rows,times,metadata).map(row=>row.tokenId)).toEqual([1931,1789]);
 const puzzle=buildSalePuzzle(input()),cutoff=puzzle.file.cutoff;
 expect(validatePuzzle(puzzle)).toEqual([]);
 expect(puzzle.file.cast.map(row=>row.tokenId)).toEqual([1931,1789,1889,876]);
 // The cutoff stops at the first record that completes the cast, not at the end of the window.
 expect(cutoff).toEqual({tx:'0x9601d98b8107d30756a05144c583648f043b950bfce7d47eb9b04e3bb7660b1b',block:110204642,logIndex:37});
 expect(at(cutoff)).toBeLessThanOrEqual(subject.at+6*3600);expect(at(cutoff)).toBeLessThan(puzzle.file.opensAt);
 for(const row of sources(puzzle)){expect(atOrBefore(row,cutoff)).toBe(true);expect(at(row)).toBeLessThan(puzzle.file.opensAt);}
 // The subject's own receipts keep the original sale as their source.
 const anchor={tx:fixture.subjectTx,block:subject.row.event.block,logIndex:fixture.subjectLogIndex};
 expect(puzzle.file.receipts.find(row=>row.id==='arrival-1931')!.sources).toEqual([anchor]);
 const payment=puzzle.file.receipts.find(row=>row.id==='payment')!;
 expect(payment.sources[0]).toEqual(anchor);expect(payment.sources.every(row=>row.tx===fixture.subjectTx)).toBe(true);
 expect(puzzle.file.tiles.find(row=>row.label===puzzle.file.subject.name)!.sources).toEqual([anchor]);
},60_000);

test('claims, solver and source reconstruction use the extended cutoff',()=>{
 const base=buildSalePuzzle(input()),catalog=catalogForPuzzle(base,{history:fixture.rows,times,metadata,ownership});
 expect(catalog.cutoff).toEqual(base.file.cutoff);
 const {puzzle,proof}=selectClaimPuzzle(base,catalog);
 expect(validatePuzzle(puzzle)).toEqual([]);expect(proof).toHaveLength((4+1)*5);expect(proof.every(row=>row.questionsSpent<=3&&row.questionsLeft>=1)).toBe(true);
 expect(verifySalePuzzleSources(base,input())).toBe(true);
 expect(verifyComposedPuzzleSources(puzzle,input(),catalog)).toBe(true);
 for(const row of sources(puzzle))expect(atOrBefore(row,puzzle.file.cutoff)).toBe(true);
},60_000);

test('the stored order of history records never changes the case',()=>{
 const forward=buildSalePuzzle(input()),reversed=buildSalePuzzle(input([...fixture.rows].reverse()));
 expect(canonicalJSON(reversed)).toBe(canonicalJSON(forward));
 const composed=(history:readonly EnrichedEvent[])=>{const base=buildSalePuzzle(input(history));return selectClaimPuzzle(base,catalogForPuzzle(base,{history,times,metadata,ownership})).puzzle;};
 expect(canonicalJSON(composed([...fixture.rows].reverse()))).toBe(canonicalJSON(composed(fixture.rows)));
},60_000);

test('sales more than six hours after the subject never join the cast',()=>{
 // Without the 14:31 and 14:32 sales the next sale is CHOG token 822 on 4 Oct 11:01, almost 22 hours later.
 const history=withoutBlocks(110204642,110204824);
 const reached=witnessCutoff({candidate:subject,history,times,metadata,opensAt:Date.parse('2026-10-10T00:20:00Z')/1000,witnesses:4});
 expect(reached.cutoff).toEqual({tx:'0x546a7f3fc289b9e4df40cbe3b85c153ade1aad56dbb296df7dfca7d69a54956a',block:110202523,logIndex:49});
 expect(reached.cast.map(row=>row.tokenId)).toEqual([1931,1789,876]);
 expect(()=>buildSalePuzzle(input(history,'2026-10-10'))).toThrow('eligible witnesses');
 // For the original day that sale is also after the case opens.
 expect(()=>buildSalePuzzle(input(history))).toThrow('eligible witnesses');
},60_000);

test('records at or after opening never become evidence, even inside the six hours',()=>{
 // A case opening at 14:20:27 must stop at the 14:11 sale; the 14:20:27 sale itself is already too late.
 const opensAt=times.get(110202523)!,reached=witnessCutoff({candidate:subject,history:fixture.rows,times,metadata,opensAt,witnesses:4});
 expect(reached.cutoff).toEqual({tx:'0xf65c39fb48a3b299176bf35bddf985cbcc7447273e9203631a6ba4bee5aa4c27',block:110200833,logIndex:23});
 expect(reached.cast.map(row=>row.tokenId)).toEqual([1931,1789,876]);
},60_000);

test('the cutoff stops before the subject moves again',()=>{
 // CHOG token 876 sold at 14:11 and again at 14:20; the second sale must not become evidence in the first case.
 const first=saleAt('0xf65c39fb48a3b299176bf35bddf985cbcc7447273e9203631a6ba4bee5aa4c27',23);
 expect(()=>buildSalePuzzle(input(fixture.rows,fixture.day,first))).toThrow('eligible witnesses');
 // The same records without the later move would fill the cast, so the stop is what holds it back.
 const control=buildSalePuzzle(input(withoutBlocks(110202523),fixture.day,first));
 expect(control.file.cast).toHaveLength(4);
 expect(control.file.receipts.find(row=>row.id==='arrival-876')!.sources).toEqual([{tx:first.row.event.tx,block:first.row.event.block,logIndex:23}]);
},60_000);

test('a rehashed case with moved cutoff or cast fails source reconstruction',()=>{
 const base=buildSalePuzzle(input());
 const later=rehash(structuredClone(base));later.file.cutoff={tx:'0x11e3ab289163b8f3fce32148c694722af07b04bd5db07b47fc015da50f9c998c',block:110204824,logIndex:73};rehash(later);
 expect(validatePuzzle(later)).toEqual([]);expect(verifySalePuzzleSources(later,input())).toBe(false);
 const swapped=structuredClone(base);swapped.file.cast[3]!.name='CHOG #1';rehash(swapped);
 expect(verifySalePuzzleSources(swapped,input())).toBe(false);
 const catalog=catalogForPuzzle(base,{history:fixture.rows,times,metadata,ownership}),{puzzle}=selectClaimPuzzle(base,catalog);
 const edited=structuredClone(puzzle);edited.file.receipts[0]!.text+=' Seen twice.';rehash(edited);
 expect(validatePuzzle(edited)).toEqual([]);expect(verifyComposedPuzzleSources(edited,input(),catalog)).toBe(false);
},60_000);
