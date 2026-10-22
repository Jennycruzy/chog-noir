import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {test,expect} from 'vitest';
import config from '../../../config/cases.json' with {type:'json'};
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import type {Metadata} from '../../cases/src/build.mts';
import {saleCandidates} from '../../cases/src/select.mts';
import {buildSalePuzzle} from '../../cases/src/puzzle.mts';
import {trainingFromPuzzle,TrainingDesk} from '../src/training.mts';

// A real archived Saturday sale, replayed on a weekday.
const fixture=JSON.parse(readFileSync(new URL('../../cases/test/fixtures/witness-window.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const {tokens}=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata}[]};
const times=new Map(fixture.times),metadata=new Map(tokens.map(row=>[row.tokenId,row.metadata]));
const candidate=saleCandidates(fixture.rows,times,config).find(row=>row.row.event.tokenId===1931)!;
const replay=buildSalePuzzle({candidate,history:fixture.rows,times,metadata,day:'2026-10-05',salt:'0x'+'d4'.repeat(32),mode:'REPLAY'});
const training=trainingFromPuzzle(replay);

test('Case #0 has two witnesses, three real receipts, one direct lie with the coach line, and a two-blank solution',()=>{
 expect(training.cast).toHaveLength(2);expect(training.receipts).toHaveLength(3);expect(training.blanks).toHaveLength(2);expect(training.tiles.length).toBeLessThanOrEqual(8);
 const lie=training.statements.find(row=>row.id===training.lie.statementId)!;
 expect(lie.line).toContain('Go on, check the receipts if you don’t believe me.');
 for(const receipt of training.receipts){expect(receipt.sources.length).toBeGreaterThan(0);expect(replay.file.receipts.some(row=>row.text===receipt.text)).toBe(true);}
 expect(training.receipts.map(row=>row.id)).toContain(training.lie.receiptId);
 expect(()=>trainingFromPuzzle({...replay,file:{...replay.file,mode:'DAILY'}})).toThrow();
});

test('the server decides the catch and the solution; a forged or reused-elsewhere token is refused',()=>{
 const desk=new TrainingDesk(randomBytes(32),()=>training);let {token,view}=desk.start();
 expect(view.blanks).toEqual([]);
 const other=training.statements.find(row=>row.id!==training.lie.statementId)!;
 ({token,view}=desk.act(token,{type:'present',statementId:other.id,receiptId:training.lie.receiptId}));expect(view.caught).toBe(false);expect(view.notice).toBe('The receipt agrees with this one.');
 expect(()=>desk.act(token,{type:'solve',tiles:training.answers})).toThrow('Catch the lie first');
 ({token,view}=desk.act(token,{type:'present',statementId:training.lie.statementId,receiptId:training.lie.receiptId}));expect(view.caught).toBe(true);expect(view.notice).toMatch(/^CAUGHT\. /);expect(view.blanks).toHaveLength(2);
 const [body,mac]=token.split('.');const forged=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body!,'base64url').toString()),done:true})).toString('base64url')+'.'+mac;
 expect(()=>desk.act(forged,{type:'solve',tiles:training.answers})).toThrow('Start the training case again');
 expect(()=>new TrainingDesk(randomBytes(32),()=>training).act(token,{type:'solve',tiles:training.answers})).toThrow('Start the training case again');
 ({view}=desk.act(token,{type:'solve',tiles:training.answers}));expect(view.feedback).toBe('All correct');expect(view.done).toBe(true);
});
