import {createHmac,timingSafeEqual} from 'node:crypto';
import {keccak256,toBytes} from 'viem';
import {planFor,validatePuzzle,type PuzzleCase} from '../../cases/src/puzzle.mts';

export class TrainingError extends Error {constructor(public readonly code:string,message:string,public readonly status=400){super(message);}}
/** Case #0: a real archived case reduced to two witnesses, three receipts, one direct lie and a two-blank solution. */
export interface TrainingCase {
 v:1;id:string;title:string;setup:string;ruleLine:string;sourceCase:string;
 cast:{tokenId:number;name:string;nickname:string}[];statements:{id:string;witness:number;line:string}[];
 receipts:{id:string;text:string;sources:PuzzleCase['file']['receipts'][number]['sources']}[];
 lie:{statementId:string;receiptId:string;inference:string;unlockedTruth:string};
 blanks:{id:string;label:string}[];tiles:{id:string;label:string}[];answers:Record<string,string>;
}
interface Progress {caught:boolean;wrong:number;attempts:number;feedback:'All correct'|'1 wrong'|'2 or more wrong'|null;done:boolean}
const COACH='Go on, check the receipts if you don’t believe me.';

export function trainingFromPuzzle(puzzle:PuzzleCase):TrainingCase{
 if(validatePuzzle(puzzle).length||puzzle.file.mode!=='REPLAY')throw new TrainingError('TRAINING_SOURCE_INVALID','Training needs a validated replay of a real case.',503);
 const plan=planFor(puzzle,null),lie=plan.lies.find(row=>row.id==='A')!,subject=puzzle.file.subject;
 const statement=plan.statements.find(row=>row.id===lie.statementId)!,breaking=puzzle.file.receipts.find(row=>row.id===lie.receiptId)!;
 const payment=puzzle.file.receipts.find(row=>row.id==='payment')!,liar=puzzle.file.cast.find(row=>row.tokenId===lie.witness)!;
 const other=puzzle.file.cast.find(row=>row.tokenId!==liar.tokenId&&row.tokenId===subject.tokenId)??puzzle.file.cast.find(row=>row.tokenId!==liar.tokenId)!;
 const truthful=plan.statements.find(row=>row.witness===other.tokenId&&row.slot==='opening'&&!plan.lies.some(item=>item.statementId===row.id))!;
 const extra=puzzle.file.receipts.find(row=>row.id!==breaking.id&&row.id!==payment.id&&row.facts.some(fact=>fact.id===truthful.claim.factId))??puzzle.file.receipts.find(row=>row.id!==breaking.id&&row.id!==payment.id)!;
 const route=puzzle.file.tiles.find(row=>row.id===puzzle.key.answers.move)!.label,otherRoute=route==='an accepted offer'?'a listing purchase':'an accepted offer';
 const tile=(label:string)=>({id:keccak256(toBytes(puzzle.file.id+':training:'+label)).slice(0,18),label});
 const subjectTile=tile(subject.name),routeTile=tile(route),tiles=[subjectTile,routeTile,tile(other.tokenId===subject.tokenId?liar.name:other.name),tile(otherRoute)].sort((a,b)=>a.id.localeCompare(b.id));
 if(new Set(tiles.map(row=>row.label)).size!==tiles.length)throw new TrainingError('TRAINING_SOURCE_INVALID','Training tiles must be distinct.',503);
 return {v:1,id:'training-'+puzzle.file.id,title:'Case #0 · '+puzzle.file.title,setup:puzzle.file.setup,ruleLine:'One Chog is lying. Present the receipt that proves it.',sourceCase:puzzle.file.id,
  cast:[liar,other].map(({tokenId,name,nickname})=>({tokenId,name,nickname})),
  statements:[{id:statement.id,witness:liar.tokenId,line:statement.line+' '+COACH},{id:truthful.id,witness:other.tokenId,line:truthful.line}],
  receipts:[breaking,payment,extra].map(row=>({id:row.id,text:row.text,sources:row.sources})),
  lie:{statementId:statement.id,receiptId:breaking.id,inference:lie.inference,unlockedTruth:lie.unlock.line},
  blanks:[{id:'subject',label:'Chog'},{id:'move',label:'moved in'}],tiles,answers:{subject:subjectTile.id,move:routeTile.id}};
}

/** Stateless sessions: progress travels with the player in a server-signed token, and the server still decides every catch. */
export class TrainingDesk {
 constructor(private readonly secret:Buffer,private readonly current:()=>TrainingCase|null){}
 private sign(progress:Progress,id:string){const body=Buffer.from(JSON.stringify({id,...progress})).toString('base64url');return body+'.'+createHmac('sha256',this.secret).update(body).digest('base64url');}
 private read(token:unknown,id:string):Progress{
  if(typeof token!=='string'||token.length>600)throw new TrainingError('TRAINING_TOKEN_INVALID','Start the training case again.');
  const [body,mac]=token.split('.');const expected=createHmac('sha256',this.secret).update(body??'').digest();
  let given:Buffer;try{given=Buffer.from(mac??'','base64url');}catch{throw new TrainingError('TRAINING_TOKEN_INVALID','Start the training case again.');}
  if(given.length!==expected.length||!timingSafeEqual(given,expected))throw new TrainingError('TRAINING_TOKEN_INVALID','Start the training case again.');
  const value=JSON.parse(Buffer.from(body!,'base64url').toString());if(value.id!==id)throw new TrainingError('TRAINING_TOKEN_INVALID','Start the training case again.');
  return {caught:value.caught,wrong:value.wrong,attempts:value.attempts,feedback:value.feedback,done:value.done};
 }
 private training(){const value=this.current();if(!value)throw new TrainingError('TRAINING_UNAVAILABLE','The training case is being prepared. Skip to today’s case.',503);return value;}
 private view(t:TrainingCase,progress:Progress,notice:string|null){
  return {title:t.title,setup:t.setup,ruleLine:t.ruleLine,cast:t.cast,statements:t.statements.map(({id,witness,line})=>({id,witness,line})),receipts:t.receipts,
   caught:progress.caught,unlockedTruth:progress.caught?t.lie.unlockedTruth:null,blanks:progress.caught?t.blanks:[],tiles:progress.caught?t.tiles:[],feedback:progress.feedback,done:progress.done,notice};
 }
 start(){const t=this.training(),progress:Progress={caught:false,wrong:0,attempts:0,feedback:null,done:false};return {token:this.sign(progress,t.id),view:this.view(t,progress,null)};}
 act(token:unknown,action:{type?:unknown;statementId?:unknown;receiptId?:unknown;tiles?:unknown}){
  const t=this.training(),progress=this.read(token,t.id);let notice:string|null=null;
  if(progress.done)throw new TrainingError('TRAINING_DONE','The training case is closed.',409);
  if(action.type==='present'){
   if(!t.statements.some(row=>row.id===action.statementId)||!t.receipts.some(row=>row.id===action.receiptId))throw new TrainingError('ACTION_INVALID','Choose a statement and a receipt.');
   if(action.statementId===t.lie.statementId&&action.receiptId===t.lie.receiptId){progress.caught=true;notice='CAUGHT. '+t.lie.inference;}
   else{progress.wrong++;notice='The receipt agrees with this one.';}
  }else if(action.type==='solve'){
   const tiles=action.tiles as Record<string,unknown>;
   if(!progress.caught)throw new TrainingError('ACTION_INVALID','Catch the lie first.');
   if(!tiles||typeof tiles!=='object'||t.blanks.some(blank=>!t.tiles.some(tile=>tile.id===tiles[blank.id])))throw new TrainingError('SOLUTION_INCOMPLETE','Fill every blank with a tile.');
   progress.attempts++;const wrong=t.blanks.filter(blank=>tiles[blank.id]!==t.answers[blank.id]).length;
   progress.feedback=wrong===0?'All correct':wrong===1?'1 wrong':'2 or more wrong';progress.done=wrong===0||progress.attempts>=2;
  }else throw new TrainingError('ACTION_INVALID','Choose a training action.');
  return {token:this.sign(progress,t.id),view:this.view(t,progress,notice)};
 }
}
