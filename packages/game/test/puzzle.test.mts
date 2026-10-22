import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,expect} from 'vitest';
import config from '../../../config/cases.json' with {type:'json'};
import {buildLinkedCast,canonicalJSON,type Metadata} from '../../cases/src/build.mts';
import {keccak256,toBytes} from 'viem';
import {saleCandidates} from '../../cases/src/select.mts';
import {buildSalePuzzle,validatePuzzle,verifySalePuzzleSources,planFor,puzzleHash,type PuzzleCase} from '../../cases/src/puzzle.mts';
import type {EnrichedEvent} from '../../core/src/enrich.mts';
import {applyPuzzleAction,createPuzzleSession,viewPuzzleSession,puzzleScore,type PuzzleAction,type PuzzleSession,type PuzzleDetective} from '../src/puzzle-session.mts';
import {provePuzzleSolvable} from '../../solver/src/solve.mts';
import {RookieDesk} from '../src/rookie.mts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/puzzle-sale.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const {tokens}=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata}[]};
const metadata=new Map(tokens.map(row=>[row.tokenId,row.metadata])),times=new Map(fixture.times);
const candidate=saleCandidates(fixture.rows,times,config).reverse().find(row=>buildLinkedCast(row,fixture.rows,times,metadata).length>=4)!;
if(!candidate)throw new Error('Missing real sale with four witnesses');
const after=new Date((candidate.at+7*86400)*1000);after.setUTCDate(after.getUTCDate()+(8-after.getUTCDay())%7);
const monday=Date.parse(after.toISOString().slice(0,10)+'T00:00:00Z');
const build=(offset=0)=>buildSalePuzzle({candidate,history:fixture.rows,times,metadata,day:new Date(monday+offset*86400000).toISOString().slice(0,10),salt:'0x'+'ab'.repeat(32),mode:'REPLAY'});
const detective=(puzzle:PuzzleCase,skill:PuzzleDetective['skill']='XRAY'):PuzzleDetective=>{const id=tokens.find(row=>!puzzle.file.cast.some(member=>member.tokenId===row.tokenId))!.tokenId;return {tokenId:id,name:metadata.get(id)!.name,skill,uses:1,questions:6,moneyTalk:false,side:null,freePress:[]};};
const act=(puzzle:PuzzleCase,state:PuzzleSession,input:Record<string,unknown>)=>applyPuzzleAction(puzzle,state,{...input,revision:state.revision} as PuzzleAction,puzzle.file.opensAt);

test('all seven daily patterns and every skill solve with budget four, including own-Chog alternates',()=>{
 for(let day=0;day<7;day++){
  const puzzle=build(day);expect(validatePuzzle(puzzle)).toEqual([]);
  expect(puzzle.file.cast).toHaveLength(day<5?3:4);expect(puzzle.key.plans.default!.lies).toHaveLength(day<5?2:3);
  const proof=provePuzzleSolvable(puzzle);expect(proof).toHaveLength(((day<5?3:4)+1)*5);expect(proof.every(row=>row.questionsSpent<=3&&row.questionsLeft>=1&&row.grade==='A')).toBe(true);
  const reverse=buildSalePuzzle({candidate,history:[...fixture.rows].reverse(),times,metadata,day:puzzle.file.day,salt:puzzle.key.salt,mode:'REPLAY'});expect(reverse).toEqual(puzzle);
 }
});
test('protected detectives pass every lie to a truthful witness while receipts and solution stay shared',()=>{
 const puzzle=build(6),base=planFor(puzzle,null);
 for(const witness of new Set(base.lies.map(row=>row.witness))){
  const plan=planFor(puzzle,witness);expect(plan.lies.some(row=>row.witness===witness)).toBe(false);
  for(const lie of base.lies){const alternate=plan.lies.find(row=>row.id===lie.id)!;expect(alternate).toMatchObject({trueValue:lie.trueValue,falseValue:lie.falseValue,receiptId:lie.receiptId});if(lie.witness===witness)expect(alternate.witness).not.toBe(witness);else expect(alternate.witness).toBe(lie.witness);}
  expect(plan.lies[0]!.witness).toBe(plan.lies[1]!.witness);
 }
});
test('catch A opens the receipt, B still needs a Press, and correct Presents spend no questions',()=>{
 const puzzle=build(2),base=planFor(puzzle,null),first=base.lies[0]!,second=base.lies[1]!;
 let state=createPuzzleSession(puzzle,detective(puzzle),'HOLDER');const initial=viewPuzzleSession(puzzle,state),encoded=JSON.stringify(initial);
 expect(encoded).not.toContain(puzzle.key.salt);expect(encoded).not.toContain('trueValue');expect(encoded).not.toContain('factId');expect(encoded).not.toContain('contentHash');expect(initial.receipts.find(row=>row.id==='payment')).toEqual({id:'payment',sealed:true});
 expect(()=>act(puzzle,state,{type:'present',statementId:second.statementId,receiptId:second.receiptId})).toThrow('Press this witness');
 state=act(puzzle,state,{type:'present',statementId:first.statementId,receiptId:first.receiptId});expect(state.questions).toBe(6);expect(state.opened).toContain('payment');
 state=act(puzzle,state,{type:'press',witness:second.witness});expect(state.questions).toBe(5);
 state=act(puzzle,state,{type:'present',statementId:second.statementId,receiptId:second.receiptId});expect(state.questions).toBe(5);
 state=act(puzzle,state,{type:'solve',tiles:puzzle.key.answers});expect(puzzleScore(puzzle,state)).toMatchObject({grade:'A'});expect(puzzleScore(puzzle,state).score).toBe(puzzleScore(puzzle,state).max);
 const reveal=viewPuzzleSession(puzzle,state),result=reveal.result!;expect(reveal.statements).toEqual([]);expect(result.truth).toHaveLength(3);expect(result.panels.every(panel=>panel.label==='CAUGHT — false statement'&&panel.receipt&&'text' in panel.receipt)).toBe(true);expect(result).not.toHaveProperty('recorded');
 for(const lie of base.lies)expect(JSON.stringify(result.truth)).not.toContain(lie.falseValue);
});
test('wrong Presents cost a question, stale actions cannot charge twice, and zero questions still allow Present and Solve',()=>{
 const puzzle=build(),lie=planFor(puzzle,null).lies[0]!;let state=createPuzzleSession(puzzle,detective(puzzle),'HOLDER');
 const wrong=puzzle.file.receipts.find(row=>row.id!==lie.receiptId)!.id;
 const action={type:'present' as const,statementId:lie.statementId,receiptId:wrong,revision:0};state=applyPuzzleAction(puzzle,state,action,puzzle.file.opensAt);expect(state.questions).toBe(5);
 expect(()=>applyPuzzleAction(puzzle,state,action,puzzle.file.opensAt)).toThrow('latest case view');
 while(state.questions)state=act(puzzle,state,{type:'present',statementId:lie.statementId,receiptId:wrong});
 state=act(puzzle,state,{type:'present',statementId:lie.statementId,receiptId:lie.receiptId});expect(state.caught).toContain('A');expect(state.questions).toBe(0);
 state=act(puzzle,state,{type:'solve',tiles:puzzle.key.answers});expect(state.solved).toBe(true);
});
test('solution feedback is partial, the second failed attempt ends play, and a second-try solve earns fewer points',()=>{
 const puzzle=build(),truth=puzzle.key.answers,wrong={...truth},other=puzzle.file.tiles.find(row=>row.id!==truth.subject)!;
 wrong.subject=other.id;let state=createPuzzleSession(puzzle,detective(puzzle),'HOLDER');state=act(puzzle,state,{type:'solve',tiles:wrong});
 expect(state.feedback).toBe('1 wrong');expect(state.done).toBe(false);expect(viewPuzzleSession(puzzle,state).result).toBeNull();
 const failed=act(puzzle,state,{type:'solve',tiles:{...wrong,move:truth.subject}});expect(failed.feedback).toBe('2 or more wrong');expect(failed.done).toBe(true);expect(failed.solved).toBe(false);
 const solved=act(puzzle,state,{type:'solve',tiles:truth}),first=act(puzzle,createPuzzleSession(puzzle,detective(puzzle),'HOLDER'),{type:'solve',tiles:truth});expect(puzzleScore(puzzle,first).score-puzzleScore(puzzle,solved).score).toBe(100);
 expect(()=>act(puzzle,failed,{type:'solve',tiles:truth})).toThrow('finished');
});
test('skills reveal only their allowed help and Sunday C waits for B',()=>{
 const puzzle=build(6),base=planFor(puzzle,null),first=base.lies[0]!,third=base.lies[2]!;
 let state=createPuzzleSession(puzzle,detective(puzzle,'TAKES_ONE'),'HOLDER');state=act(puzzle,state,{type:'skill'});expect(state.caught).toEqual([]);expect(state.identified).toHaveLength(1);expect(viewPuzzleSession(puzzle,state).identified[0]!.message).toBe('One of the two lying witnesses.');
 expect(()=>act(puzzle,state,{type:'press',witness:third.witness})).toThrow('earlier receipt');
 state=createPuzzleSession(puzzle,detective(puzzle,'ANALYST'),'HOLDER');state=act(puzzle,state,{type:'skill',statementId:first.statementId});expect(state.highlighted).toEqual([first.receiptId]);expect(state.caught).toEqual([]);
 state=createPuzzleSession(puzzle,detective(puzzle,'XRAY'),'HOLDER');state=act(puzzle,state,{type:'skill',receiptId:'payment'});expect(state.questions).toBe(6);expect(state.opened).toContain('payment');
 state=createPuzzleSession(puzzle,{...detective(puzzle,'LEGEND'),uses:3},'HOLDER');state=act(puzzle,state,{type:'skill',receiptId:'payment'});expect(state.skillUses).toBe(0);expect(state.opened).toContain('payment');expect(state.identified).toHaveLength(1);
});
test('holder links and Side make Press free while Rookie badges cannot receive those bonuses',()=>{
 const puzzle=build(),liar=planFor(puzzle,null).lies[1]!.witness;
 let state=createPuzzleSession(puzzle,{...detective(puzzle),freePress:[liar]},'HOLDER');state=act(puzzle,state,{type:'press',witness:liar});expect(state.questions).toBe(6);expect(state.sideUsed).toBe(false);
 const witness=puzzle.file.cast.find(row=>row.side!==null)!;state=createPuzzleSession(puzzle,{...detective(puzzle),side:witness.side},'HOLDER');state=act(puzzle,state,{type:'press',witness:witness.tokenId});expect(state.sideUsed).toBe(true);expect(state.questions).toBe(6);
 expect(()=>createPuzzleSession(puzzle,{...detective(puzzle),freePress:[liar]},'ROOKIE')).toThrow('holder bonuses');
});
test('a complete Rookie puzzle writes only temporary desk storage and returns a ROOKIE DESK share label',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-puzzle-')),puzzle=build(2),current={id:puzzle.file.id,day:puzzle.file.day,opensAt:puzzle.file.opensAt*1000,closesAt:puzzle.file.closesAt*1000,salt:puzzle.key.salt,cast:puzzle.file.cast.map(row=>row.tokenId)};
 try{
  for(const directory of ['career','stats','chain','precinct','push']){await mkdir(join(root,'runs',directory),{recursive:true});await writeFile(join(root,'runs',directory,'existing.json'),'{"unchanged":true}');}
  const desk=new RookieDesk<PuzzleSession>({root,metadata,now:()=>current.opensAt+1000});
  const opened=await desk.start(current,{ip:'127.0.0.1',create:badge=>createPuzzleSession(puzzle,{tokenId:badge.tokenId,name:badge.name,skill:badge.skill,uses:badge.uses,questions:badge.questions,moneyTalk:false,side:null,freePress:[]},'ROOKIE')});
  let session=opened.session;
  const move=async(input:Record<string,unknown>)=>{session=await desk.action(current,opened.token,session.revision,state=>{const next=act(puzzle,state,input);return {state:next,done:next.done};});};
  for(const lie of planFor(puzzle,null).lies){if(planFor(puzzle,null).statements.find(row=>row.id===lie.statementId)!.slot==='followup')await move({type:'press',witness:lie.witness});await move({type:'present',statementId:lie.statementId,receiptId:lie.receiptId});}
  await move({type:'solve',tiles:puzzle.key.answers});expect(viewPuzzleSession(puzzle,session.state).result?.shareLabel).toBe('ROOKIE DESK');
  for(const directory of ['career','stats','chain','precinct','push']){expect(await readdir(join(root,'runs',directory))).toEqual(['existing.json']);expect(await readFile(join(root,'runs',directory,'existing.json'),'utf8')).toBe('{"unchanged":true}');}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('tampering and missing source data fail validation; daily actions reject the wrong time window',()=>{
 const puzzle=build();puzzle.file.receipts[0]!.text='changed';expect(validatePuzzle(puzzle)).toContain('CASE_COMMITMENT');
 const clean=build();clean.key.plans.default!.lies[1]!.witness=clean.key.plans.default!.lies[0]!.witness+1;clean.answerHash=puzzleHash(clean);expect(validatePuzzle(clean)).toContain('CASE_LIAR_PATTERN');
 const altered=structuredClone(candidate);altered.row.event.price!.grossWei='1';expect(()=>buildSalePuzzle({candidate:altered,history:fixture.rows,times,metadata,day:clean.file.day,salt:clean.key.salt,mode:'REPLAY'})).toThrow('source-backed sale');
 const daily=buildSalePuzzle({candidate,history:fixture.rows,times,metadata,day:clean.file.day,salt:clean.key.salt,mode:'DAILY'}),state=createPuzzleSession(daily,detective(daily),'HOLDER');
 expect(()=>applyPuzzleAction(daily,state,{type:'solve',tiles:daily.key.answers,revision:0},daily.file.closesAt)).toThrow('closed');
});
test('a fresh commitment cannot make rewritten receipt facts match the stored sale sources',()=>{
 const puzzle=build(),input={candidate,history:fixture.rows,times,metadata};expect(verifySalePuzzleSources(puzzle,input)).toBe(true);
 puzzle.file.receipts[0]!.text+=' An extra claim.';puzzle.key.contentHash=keccak256(toBytes(canonicalJSON(puzzle.file)));puzzle.answerHash=puzzleHash(puzzle);
 expect(validatePuzzle(puzzle)).toEqual([]);expect(verifySalePuzzleSources(puzzle,input)).toBe(false);
});
test('a voiced statement cannot add a Chog name or number beyond its code-chosen claim',()=>{
 const puzzle=build();puzzle.key.plans.default!.statements[0]!.line+=' CHOG #1969';puzzle.answerHash=puzzleHash(puzzle);
 expect(validatePuzzle(puzzle)).toContain('CASE_STATEMENT_WORDS');
});
