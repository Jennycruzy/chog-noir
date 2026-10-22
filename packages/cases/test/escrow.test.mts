import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import config from '../../../config/cases.json' with {type:'json'};
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import type {OwnerSnapshot} from '../../auth/src/holders.mts';
import type {Metadata} from '../src/build.mts';
import {saleCandidates,escrowCandidates,rankCandidates} from '../src/select.mts';
import {buildSalePuzzle,validatePuzzle,verifySalePuzzleSources,planFor} from '../src/puzzle.mts';
import {catalogForPuzzle,selectClaimPuzzle,verifyComposedPuzzleSources} from '../src/compose.mts';

// Real records: CHOG token 1021 sold through escrow for 2 $CHOG on 14 Oct, with the full histories of its witnesses.
const trail=JSON.parse(readFileSync(new URL('./fixtures/chog-trail.json',import.meta.url),'utf8')) as {subjectTx:string;subjectLogIndex:number;rows:EnrichedEvent[];times:[number,number][]};
const window=JSON.parse(readFileSync(new URL('./fixtures/witness-window.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const {snapshot:ownership}=JSON.parse(readFileSync(new URL('../../auth/test/fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot};
const {tokens}=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata}[]};
const metadata=new Map(tokens.map(row=>[row.tokenId,row.metadata])),times=new Map(trail.times);
const deal=escrowCandidates(trail.rows,times).find(row=>row.row.event.tx===trail.subjectTx&&row.row.event.logIndex===trail.subjectLogIndex)!;
const input={candidate:deal,history:trail.rows,times,metadata,day:'2026-10-15',salt:'0x'+'e5'.repeat(32),mode:'REPLAY' as const};

test('a $CHOG escrow deal becomes a CHOG_TRAIL case priced by the token transfer to the seller',()=>{
 expect(deal.type).toBe('CHOG_TRAIL');
 const puzzle=buildSalePuzzle(input),payment=puzzle.file.receipts.find(row=>row.id==='payment')!;
 expect(validatePuzzle(puzzle)).toEqual([]);expect(verifySalePuzzleSources(puzzle,input)).toBe(true);
 expect(puzzle.file.title).toBe('Follow the $CHOG');expect(puzzle.file.setup).toContain('escrow deal paid in $CHOG');
 expect(payment.text).toBe(`${puzzle.file.subject.name} · an escrow deal · Paid: 2 $CHOG.`);
 const proof=deal.row.event.escrow!.paymentProof as {kind:'ERC20';log:{transactionHash:string;logIndex:number}};
 expect(payment.sources).toContainEqual({tx:proof.log.transactionHash,block:deal.row.event.block,logIndex:proof.log.logIndex});
 // The deal's buyer, not the escrow contract, decides who the buyer's other Chogs are.
 expect(puzzle.file.cast.map(row=>row.tokenId)).toContain(1358);
 const price=planFor(puzzle,null).lies.find(row=>row.kind==='D5');if(price)expect(price.falseValue).toContain('4 $CHOG');
 for(const blank of puzzle.file.blanks)expect(puzzle.file.tiles.some(tile=>tile.id===puzzle.key.answers[blank.id])).toBe(true);
 expect(puzzle.file.tiles.find(tile=>tile.id===puzzle.key.answers.move)!.label).toBe('an escrow deal');
},120_000);

test('the composed CHOG_TRAIL case reconstructs from its sources and is solvable with every skill',()=>{
 const base=buildSalePuzzle(input),catalog=catalogForPuzzle(base,{history:trail.rows,times,metadata,ownership}),{puzzle,proof}=selectClaimPuzzle(base,catalog);
 expect(verifyComposedPuzzleSources(puzzle,input,catalog)).toBe(true);expect(proof.every(row=>row.questionsSpent<=3&&row.questionsLeft>=1)).toBe(true);
},120_000);

test('a Founder leaving its minter for the first time is a FIRST_MOVE and leads the day',()=>{
 const windowTimes=new Map(window.times),sales=saleCandidates(window.rows,windowTimes,config);
 // CHOG token 1889 was minted on 5 Sep and first sold by its minter on 7 Sep.
 const first=sales.filter(row=>row.row.event.tokenId===1889&&row.row.event.block===102789930);
 expect(first.map(row=>row.type)).toContain('FIRST_MOVE');
 const ranked=rankCandidates(sales,{day:'2026-09-07',previous:[],castQuality:()=>0});
 expect(ranked[0]!.candidate.type).toBe('FIRST_MOVE');
 const resale=sales.filter(row=>row.row.event.tokenId===1889&&row.row.event.block!==102789930);expect(resale.every(row=>row.type!=='FIRST_MOVE')).toBe(true);
});
