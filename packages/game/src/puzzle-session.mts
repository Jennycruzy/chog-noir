import {planFor,validatePuzzle,type PuzzleCase,type LieId} from '../../cases/src/puzzle.mts';
import type {DetectiveSkill} from '../../traits/src/detective.mts';

export class PuzzleActionError extends Error {constructor(public readonly code:string,message:string,public readonly status=400){super(message);}}
export interface PuzzleDetective {tokenId:number;name:string;skill:DetectiveSkill;uses:number;questions:number;moneyTalk:boolean;side:'BUYER'|'SELLER'|null;freePress:number[]}
export interface PuzzleSession {
 v:2;mode:'HOLDER'|'ROOKIE';caseId:string;detective:PuzzleDetective;revision:number;questions:number;initialQuestions:number;
 pressed:number[];opened:string[];caught:LieId[];identified:number[];highlighted:string[];skillUses:number;sideUsed:boolean;
 wrongPresents:number;attempts:number;feedback:'All correct'|'1 wrong'|'2 or more wrong'|null;notice:string|null;done:boolean;solved:boolean;solutionAttempt:number|null;
}
export type PuzzleAction=
 |{type:'press';witness:number;revision:number}|{type:'present';statementId:string;receiptId:string;revision:number}
 |{type:'open';receiptId:string;revision:number}|{type:'skill';receiptId?:string;statementId?:string;revision:number}
 |{type:'solve';tiles:Record<string,string>;revision:number};
const error=(code:string,message:string,status=400):never=>{throw new PuzzleActionError(code,message,status);};
export function createPuzzleSession(puzzle:PuzzleCase,detective:PuzzleDetective,mode:'HOLDER'|'ROOKIE'):PuzzleSession{
 if(validatePuzzle(puzzle).length)return error('CASE_INVALID','This case could not be checked.',503);
 if(!['HOLDER','ROOKIE'].includes(mode)||!Number.isSafeInteger(detective.tokenId)||detective.tokenId<1||detective.tokenId>1969||!detective.name||!['XRAY','ANALYST','TAKES_ONE','EMPATH','LEGEND'].includes(detective.skill)||!Number.isSafeInteger(detective.uses)||detective.uses<1||detective.uses>3||!Number.isSafeInteger(detective.questions)||detective.questions<4||detective.questions>11||!Array.isArray(detective.freePress)||detective.freePress.some(id=>!puzzle.file.cast.some(row=>row.tokenId===id)))return error('DETECTIVE_INPUT_INVALID','The detective could not be checked.',503);
 if(mode==='ROOKIE'&&(puzzle.file.cast.some(row=>row.tokenId===detective.tokenId)||detective.questions!==(detective.skill==='EMPATH'?8:6)||detective.side!==null||detective.moneyTalk||detective.freePress.length))return error('ROOKIE_BONUS_INVALID','The bureau badge cannot receive holder bonuses.',503);
 const ownReceipt=mode==='HOLDER'?puzzle.file.receipts.find(row=>row.sealed&&(row.tokenIds?.includes(detective.tokenId)||row.id==='payment'&&puzzle.file.subject.tokenId===detective.tokenId))?.id??null:null;
 return {v:2,mode,caseId:puzzle.file.id,detective:structuredClone(detective),revision:0,questions:detective.questions,initialQuestions:detective.questions,pressed:[],opened:puzzle.file.receipts.filter(row=>!row.sealed||row.id===ownReceipt).map(row=>row.id),caught:[],identified:[],highlighted:[],skillUses:detective.skill==='EMPATH'?0:detective.skill==='LEGEND'?1:detective.uses,sideUsed:false,wrongPresents:0,attempts:0,feedback:null,notice:null,done:false,solved:false,solutionAttempt:null};
}
function freePress(puzzle:PuzzleCase,session:PuzzleSession,witness:number){return session.mode==='HOLDER'&&(session.detective.freePress.includes(witness)||!session.sideUsed&&session.detective.side!==null&&puzzle.file.cast.find(row=>row.tokenId===witness)?.side===session.detective.side);}
export function applyPuzzleAction(puzzle:PuzzleCase,session:PuzzleSession,action:PuzzleAction,now:number):PuzzleSession{
 if(session.caseId!==puzzle.file.id)return error('CASE_SESSION_MISMATCH','Open the current case.',409);
 if(!Number.isSafeInteger(now)||now<0)return error('CASE_CLOCK_INVALID','The case time could not be checked.',503);
 if(puzzle.file.mode==='DAILY'&&(now<puzzle.file.opensAt||now>=puzzle.file.closesAt))return error('CASE_CLOSED','This daily case is closed.',409);
 if(action.revision!==session.revision)return error('CASE_REVISION_CHANGED','Use the latest case view.',409);
 if(session.done)return error('PLAY_ALREADY_TODAY','This detective has finished this case.',409);
 const next=structuredClone(session),plan=planFor(puzzle,next.mode==='HOLDER'?next.detective.tokenId:null);
 next.notice=null;
 const spend=(amount:number)=>{if(next.questions<amount)return error('BUDGET_EMPTY','Out of questions. You can still present receipts and solve.');next.questions-=amount;};
 const visible=(id:string)=>plan.statements.find(row=>row.id===id&&(row.slot==='opening'||next.pressed.includes(row.witness))&&row.requiresCaught.every(lie=>next.caught.includes(lie)));
 switch(action.type){
  case 'press':{
   const followup=plan.statements.find(row=>row.witness===action.witness&&row.slot==='followup');
   if(!followup)return error('WITNESS_INVALID','Choose a witness in this case.');
   if(followup.requiresCaught.some(id=>!next.caught.includes(id)))return error('STATEMENT_LOCKED','Present the earlier receipt first.');
   if(!next.pressed.includes(action.witness)){
    if(freePress(puzzle,next,action.witness)){if(!next.detective.freePress.includes(action.witness))next.sideUsed=true;}else spend(1);
    next.pressed.push(action.witness);
   }break;
  }
  case 'open':{
   if(!puzzle.file.receipts.some(row=>row.id===action.receiptId))return error('RECEIPT_INVALID','Choose a receipt in this case.');
   if(!next.opened.includes(action.receiptId)){spend(2);next.opened.push(action.receiptId);}break;
  }
  case 'present':{
   const statement=visible(action.statementId);if(!statement)return error('STATEMENT_HIDDEN','Press this witness before presenting a receipt.');
   if(!next.opened.includes(action.receiptId))return error('RECEIPT_SEALED','Open this receipt before presenting it.');
   const lie=plan.lies.find(row=>row.statementId===statement.id);
   if(lie&&next.caught.includes(lie.id))return error('LIE_ALREADY_CAUGHT','That statement is already marked CAUGHT.');
   if(lie&&lie.receiptId===action.receiptId){next.caught.push(lie.id);next.notice='CAUGHT. '+lie.inference;if(lie.unlock.receiptId&&!next.opened.includes(lie.unlock.receiptId))next.opened.push(lie.unlock.receiptId);}
   else{next.questions=Math.max(0,next.questions-1);next.wrongPresents++;next.notice='The receipt agrees with this one. −1 question.';}break;
  }
  case 'skill':{
   if(next.skillUses<=0)return error('SKILL_EMPTY','This skill has no uses left.');
   const skill=next.detective.skill;
   if(skill==='XRAY'||skill==='LEGEND'){
    const receipt=puzzle.file.receipts.find(row=>row.id===action.receiptId&&row.sealed&&!next.opened.includes(row.id));
    if(!receipt&&skill==='XRAY')return error('RECEIPT_NOT_SEALED','Choose a receipt that is still sealed.');
    if(receipt)next.opened.push(receipt.id);
   }
   if(skill==='TAKES_ONE'||skill==='LEGEND'){
    const liar=plan.lies.find(row=>!next.identified.includes(row.witness));
    if(!liar)return error('LIAR_ALREADY_IDENTIFIED','The lying witnesses are already identified.');
    next.identified.push(liar.witness);
   }
   if(skill==='ANALYST'){
    const statement=typeof action.statementId==='string'?visible(action.statementId):undefined;
    if(!statement)return error('STATEMENT_HIDDEN','Choose a visible statement.');
    next.highlighted=puzzle.file.receipts.filter(row=>row.facts.some(fact=>fact.id===statement.claim.factId)).map(row=>row.id);
   }
   next.skillUses--;break;
  }
  case 'solve':{
   if(!action.tiles||typeof action.tiles!=='object'||Array.isArray(action.tiles)||Object.keys(action.tiles).length!==puzzle.file.blanks.length||puzzle.file.blanks.some(blank=>!puzzle.file.tiles.some(tile=>tile.id===action.tiles[blank.id])))return error('SOLUTION_INCOMPLETE','Fill every blank with a tile.');
   next.attempts++;const wrong=puzzle.file.blanks.filter(blank=>action.tiles[blank.id]!==puzzle.key.answers[blank.id]).length;
   next.feedback=wrong===0?'All correct':wrong===1?'1 wrong':'2 or more wrong';
   if(wrong===0){next.solved=true;next.solutionAttempt=next.attempts;next.done=true;}else if(next.attempts===2)next.done=true;
   break;
  }
  default:return error('ACTION_INVALID','Choose a case action.');
 }
 next.revision++;return next;
}
export function puzzleScore(puzzle:PuzzleCase,session:PuzzleSession){
 const plan=planFor(puzzle,session.mode==='HOLDER'?session.detective.tokenId:null),needed=new Set(plan.lies.map(lie=>plan.statements.find(row=>row.id===lie.statementId)!).filter(row=>row.slot==='followup').map(row=>row.witness));
 let mandatory=0,sideUsed=false;
 for(const witness of needed){if(session.mode==='HOLDER'&&session.detective.freePress.includes(witness))continue;const side=puzzle.file.cast.find(row=>row.tokenId===witness)?.side;if(session.mode==='HOLDER'&&!sideUsed&&session.detective.side!==null&&session.detective.side===side)sideUsed=true;else mandatory++;}
 const max=plan.lies.length*150+200+(session.initialQuestions-mandatory)*10+50;
 const score=session.caught.length*150+(session.solved?(session.solutionAttempt===1?200:100):0)+session.questions*10+(session.wrongPresents===0?50:0);
 return {score,max,grade:score>=max*0.85?'A' as const:score>=max*0.65?'B' as const:score>=max*0.4?'C' as const:'D' as const};
}
export function viewPuzzleSession(puzzle:PuzzleCase,session:PuzzleSession){
 const plan=planFor(puzzle,session.mode==='HOLDER'?session.detective.tokenId:null),visible=plan.statements.filter(row=>(row.slot==='opening'||session.pressed.includes(row.witness))&&row.requiresCaught.every(id=>session.caught.includes(id)));
 const receipts=puzzle.file.receipts.map(row=>session.opened.includes(row.id)||session.done?{id:row.id,sealed:false,text:session.detective.moneyTalk?row.exactText:row.text,at:row.at,sources:row.sources}:{id:row.id,sealed:true});
 const caught=plan.lies.filter(lie=>session.caught.includes(lie.id));
 const arrival=puzzle.file.receipts.find(row=>row.id==='arrival-'+puzzle.file.subject.tokenId)!,payment=puzzle.file.receipts.find(row=>row.id==='payment')!;
 return {v:2,case:{id:puzzle.file.id,day:puzzle.file.day,mode:puzzle.file.mode,title:puzzle.file.title,setup:puzzle.file.setup,ruleLine:puzzle.file.ruleLine,cast:puzzle.file.cast,tiles:puzzle.file.tiles.map(({id,label})=>({id,label})),blanks:puzzle.file.blanks,answerHash:puzzle.answerHash},mode:session.mode,ownChogMessage:session.mode==='HOLDER'&&puzzle.file.cast.some(row=>row.tokenId===session.detective.tokenId)?"Your Chog is in today's case.":null,detective:{tokenId:session.detective.tokenId,name:session.detective.name,skill:session.detective.skill},revision:session.revision,questions:session.questions,skillUses:session.skillUses,
  statements:session.done?[]:visible.map(({id,witness,slot,line})=>({id,witness,slot,line})),receipts,caught:caught.map(row=>({id:row.id,statementId:row.statementId,message:'CAUGHT. '+row.inference,unlockedTruth:row.unlock.line})),identified:session.identified.map(witness=>({witness,message:plan.lies.length===3?'One of the two lying witnesses.':'The lying witness.'})),highlighted:session.highlighted,feedback:session.feedback,notice:session.notice,done:session.done,
  result:session.done?{...puzzleScore(puzzle,session),solved:session.solved,shareLabel:session.mode==='ROOKIE'?'ROOKIE DESK':session.detective.name,panels:plan.lies.map(lie=>({label:'CAUGHT — false statement',statement:plan.statements.find(row=>row.id===lie.statementId)!.line,receipt:receipts.find(row=>row.id===lie.receiptId)!})),truth:[{text:arrival.text,sources:arrival.sources},{text:session.detective.moneyTalk?payment.exactText:payment.text,sources:payment.sources},{text:'The recorded payment links this move to a purchase.',sources:payment.sources}]}:null};
}
