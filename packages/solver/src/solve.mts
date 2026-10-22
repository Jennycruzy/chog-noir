import {planFor,type PuzzleCase} from '../../cases/src/puzzle.mts';
import {applyPuzzleAction,createPuzzleSession,puzzleScore,type PuzzleDetective,type PuzzleSession,type PuzzleAction} from '../../game/src/puzzle-session.mts';
import type {DetectiveSkill} from '../../traits/src/detective.mts';

export function solvePuzzle(puzzle:PuzzleCase,detective:PuzzleDetective){
 let state=createPuzzleSession(puzzle,detective,'HOLDER');const actions:PuzzleAction[]=[],plan=planFor(puzzle,detective.tokenId);
 const apply=(action:Omit<Extract<PuzzleAction,{type:'press'}>,'revision'>|Omit<Extract<PuzzleAction,{type:'present'}>,'revision'>|Omit<Extract<PuzzleAction,{type:'solve'}>,'revision'>)=>{const next={...action,revision:state.revision} as PuzzleAction;state=applyPuzzleAction(puzzle,state,next,puzzle.file.opensAt);actions.push(next);};
 for(const id of ['A','B','C']){
  const lie=plan.lies.find(row=>row.id===id);if(!lie)continue;
  const statement=plan.statements.find(row=>row.id===lie.statementId)!;
  if(statement.slot==='followup'&&!state.pressed.includes(lie.witness))apply({type:'press',witness:lie.witness});
  apply({type:'present',statementId:lie.statementId,receiptId:lie.receiptId});
 }
 apply({type:'solve',tiles:puzzle.key.answers});
 return {state,actions,questionsSpent:state.initialQuestions-state.questions,...puzzleScore(puzzle,state)};
}
/** Proves every skill at the minimum budget for each cast member's own plan and for an outside detective's shared plan. */
export function provePuzzleSolvable(puzzle:PuzzleCase){
 const rows:{skill:DetectiveSkill;detectiveId:number;questionsSpent:number;questionsLeft:number;grade:string}[]=[],cast=puzzle.file.cast.map(row=>row.tokenId);
 const outsider=Array.from({length:1969},(_,index)=>index+1).find(id=>!cast.includes(id))!,ids=[...new Set(cast),outsider];
 for(const skill of ['XRAY','ANALYST','TAKES_ONE','EMPATH','LEGEND'] as DetectiveSkill[])for(const detectiveId of ids){
  const detective:PuzzleDetective={tokenId:detectiveId,name:puzzle.file.cast.find(row=>row.tokenId===detectiveId)?.name??'Outside detective',skill,uses:1,questions:4,moneyTalk:false,side:null,freePress:[]},result=solvePuzzle(puzzle,detective);
  if(!result.state.done||!result.state.solved||result.questionsSpent>3||result.state.questions<1||result.state.caught.length!==planFor(puzzle,detectiveId).lies.length)throw new Error('CASE_UNSOLVABLE: Perfect play must leave a question at budget four');
  rows.push({skill,detectiveId,questionsSpent:result.questionsSpent,questionsLeft:result.state.questions,grade:result.grade});
 }
 return rows;
}
