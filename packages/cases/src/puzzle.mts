import {keccak256,toBytes,formatEther} from 'viem';
import config from '../../../config/cases.json' with {type:'json'};
import {buildCast,canonicalJSON,type Metadata} from './build.mts';
import type {Candidate} from './select.mts';
import type {EnrichedEvent,Source} from '../../core/src/enrich.mts';
import {validateLine} from '../../witness/src/lines.mts';

export type LieKind='D1'|'D2'|'D3'|'D4'|'D5'|'D6'|'I1'|'I2'|'I3'|'I4'|'I5'|'I6';
export type LieId='A'|'B'|'C';
export interface PuzzleReceipt {id:string;text:string;exactText:string;at:number;sources:Source[];sealed:boolean;facts:{id:string;value:string}[]}
export interface PuzzleStatement {id:string;witness:number;slot:'opening'|'followup';line:string;claim:{factId:string;value:string};requiresCaught:LieId[]}
export interface PuzzleLie {id:LieId;witness:number;statementId:string;kind:LieKind;trueValue:string;falseValue:string;receiptId:string;inference:string;unlock:{receiptId:string|null;line:string}}
export interface PuzzlePlan {statements:PuzzleStatement[];lies:PuzzleLie[]}
export interface PuzzleFile {
 v:2;id:string;day:string;mode:'DAILY'|'REPLAY';title:string;setup:string;type:string;subject:{tokenId:number;name:string};ruleLine:string;
 opensAt:number;closesAt:number;cutoff:Source;cast:{tokenId:number;name:string;nickname:string;side:'BUYER'|'SELLER'|null}[];
 receipts:PuzzleReceipt[];tiles:{id:string;label:string;sources:Source[]}[];blanks:{id:string;label:string}[];
}
export interface PuzzleCase {file:PuzzleFile;key:{v:2;caseId:string;salt:string;contentHash:string;receiptIds:string[];answers:Record<string,string>;plans:Record<string,PuzzlePlan>};answerHash:string}
export class PuzzleError extends Error {constructor(public readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new PuzzleError(code,message);};
export function dailyDifficulty(day:string){
 const date=new Date(day+'T00:00:00Z');
 if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)return fail('CASE_DAY_INVALID','Choose a valid UTC case day.');
 return {...config.weekly[(date.getUTCDay()+6)%7]!};
}
export const puzzleRule=(day:string)=>dailyDifficulty(day).liars===1?'One Chog is lying. Present the receipt that proves it.':'Two Chogs are lying. Present the receipts that prove it.';
export const puzzleHash=(puzzle:PuzzleCase)=>keccak256(toBytes(canonicalJSON(puzzle.key)));
const identity=(row:Source)=>row.tx.toLowerCase()+':'+row.logIndex;
const source=(row:EnrichedEvent):Source=>({tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex});
const before=(a:Source,b:Source)=>a.block<b.block||a.block===b.block&&a.logIndex<=b.logIndex;
const hash=(text:string)=>keccak256(toBytes(text));
const when=(at:number)=>new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(at*1000))+' UTC';
const rounded=(wei:string,asset:string)=>'about '+((BigInt(wei)+25n*10n**18n)/(50n*10n**18n)*50n).toLocaleString('en-US')+' '+asset;
const differentPriceBand=(wei:string)=>{
 const amount=(BigInt(wei)+25n*10n**18n)/(50n*10n**18n)*50n,bounds=config.priceBandUpperMon.map(BigInt);
 const found=bounds.findIndex(bound=>amount<bound),band=found<0?bounds.length:found;
 return (band===0?bounds[0]!+500n:bounds[band-1]!-500n)*10n**18n;
};
const statementId=(id:number,slot:string)=>'w'+id+'-'+slot;

/** Build the sale puzzle from classified records; the original records remain its authority. */
export function buildSalePuzzle(input:{candidate:Candidate;history:readonly EnrichedEvent[];times:ReadonlyMap<number,number>;metadata:ReadonlyMap<number,Metadata>;day:string;salt:string;mode:'DAILY'|'REPLAY'}):PuzzleCase{
 const {candidate,history,times,metadata,day,salt,mode}=input,difficulty=dailyDifficulty(day),event=candidate.row.event,cutoff=source(candidate.row);
 if(!/^0x[a-f0-9]{64}$/i.test(salt))return fail('CASE_SALT_INVALID','A complete case salt is required.');
 const saved=history.find(row=>identity(source(row))===identity(cutoff));
 if(!saved||canonicalJSON(saved)!==canonicalJSON(candidate.row)||times.get(event.block)!==candidate.at||event.class!=='SALE'||event.price?.status!=='EXACT'||!event.price.grossWei||BigInt(event.price.grossWei)<=0n||!['MON','WMON'].includes(event.price.asset)||!['offer_accepted','listing_bought'].includes(event.route??'')||event.evidence.orderLogIndices.length===0)return fail('CASE_SOURCE_INVALID','An exact source-backed sale is required.');
 const opensAt=Date.parse(day+'T00:20:00Z')/1000;
 if(candidate.at>=opensAt)return fail('CASE_SOURCE_FUTURE','Case evidence must predate opening.');
 const cast=buildCast(candidate,history,times,metadata).filter(member=>{
  const arrival=history.find(row=>identity(source(row))===identity(member.arrival));
  return arrival&&arrival.event.class!=='UNCLASSIFIED'&&arrival.event.from!==arrival.event.to;
 }).slice(0,difficulty.witnesses);
 if(cast.length!==difficulty.witnesses)return fail('CASE_CAST_INCOMPLETE','The event needs more eligible witnesses.');
 const rows=history.filter(row=>before(source(row),cutoff)).sort((a,b)=>a.event.block-b.event.block||a.event.logIndex-b.event.logIndex),subject=metadata.get(event.tokenId);
 if(!subject)return fail('CASE_METADATA_MISSING','The subject metadata is required.');
 const nicknameWords=['The Collector','The Flipper','The Night Owl','The Founder','The Quiet One','The Courier','The Lantern','The Traveller','The Regular','The Archivist','The Wanderer','The Early Bird'];
 const owners=new Map<number,string>();for(const row of rows)if(row.event.from!==row.event.to)owners.set(row.event.tokenId,row.event.to);
 const wallets=[...new Set(cast.map(member=>owners.get(member.tokenId)!))].sort(),nicknames=new Map<string,string>(),used=new Set<string>();
 for(const wallet of wallets){if(!wallet)return fail('CASE_OWNER_MISSING','A witness owner source is required.');let index=Number(BigInt(hash(salt+wallet))%BigInt(nicknameWords.length));while(used.has(nicknameWords[index]!))index=(index+1)%nicknameWords.length;const nickname=nicknameWords[index]!;used.add(nickname);nicknames.set(wallet,nickname);}
 const arrivalValue=(name:string,at:number)=>name+' reached its new wallet on '+when(at);
 const receipts:PuzzleReceipt[]=cast.map(member=>{
  const value=arrivalValue(member.name,member.arrivedAt);
  return {id:'arrival-'+member.tokenId,text:value+'.',exactText:value+'.',at:member.arrivedAt,sources:[member.arrival],sealed:false,facts:[{id:'arrival-'+member.tokenId,value}]};
 });
 const route=event.route==='offer_accepted'?'accepted offer':'bought listing',price=rounded(event.price.grossWei,event.price.asset),paymentSources=[cutoff,...event.evidence.orderLogIndices.map(logIndex=>({tx:event.tx,block:event.block,logIndex}))];
 const paidValue=subject.name+' changed wallets through '+(event.route==='offer_accepted'?'an accepted offer':'a listing purchase'),priceValue=subject.name+' was paid for with '+price;
 receipts.push({id:'payment',text:subject.name+' · '+route+' · Paid: '+price+'.',exactText:subject.name+' · '+route+' · Paid: '+formatEther(BigInt(event.price.grossWei))+' '+event.price.asset+'.',at:candidate.at,sources:paymentSources,sealed:difficulty.sealed===1,facts:[{id:'move-kind',value:paidValue},{id:'price',value:priceValue}]});
 const castRows=cast.map(member=>({tokenId:member.tokenId,name:member.name,nickname:nicknames.get(owners.get(member.tokenId)!)!,side:member.role==='SUBJECT'||member.role==='BUYER_ROOMMATE'?'BUYER' as const:member.role==='SELLER_ROOMMATE'?'SELLER' as const:null}));
 const ranked=[...cast].sort((a,b)=>{
  const weight=(id:number)=>{const attributes=metadata.get(id)!.attributes,attr=(name:string)=>attributes.find(row=>row.trait_type===name)?.value.toLowerCase();return (['side eye','smirk','thug','mog','clown eye','clown eye mix'].includes(attr('Eyes')??'')?3:0)+(['clown','clown mouth'].includes(attr('Mouth')??'')?1:0)+(attr('Form')==='skull'?1:0);};
  return weight(b.tokenId)-weight(a.tokenId)||hash(salt+':liar:'+a.tokenId).localeCompare(hash(salt+':liar:'+b.tokenId));
 });
 const primary=ranked[0]!.tokenId,secondary=difficulty.liars===2?ranked[1]!.tokenId:null;
 const makePlan=(protectedId:number|null):PuzzlePlan=>{
  const replacement=ranked.find(row=>row.tokenId!==primary&&row.tokenId!==secondary&&row.tokenId!==protectedId)!.tokenId;
  const first=primary===protectedId?replacement:primary,second=secondary!==null&&secondary===protectedId?replacement:secondary;
  const statements:PuzzleStatement[]=cast.flatMap(member=>[
   {id:statementId(member.tokenId,'opening'),witness:member.tokenId,slot:'opening' as const,line:'I saw '+arrivalValue(member.name,member.arrivedAt)+'.',claim:{factId:'arrival-'+member.tokenId,value:arrivalValue(member.name,member.arrivedAt)},requiresCaught:[]},
   {id:statementId(member.tokenId,'followup'),witness:member.tokenId,slot:'followup' as const,line:'I saw '+paidValue+'.',claim:{factId:'move-kind',value:paidValue},requiresCaught:[]},
  ]);
  const arrivalTruth=arrivalValue(subject.name,candidate.at),falseArrival=arrivalValue(subject.name,candidate.at-86400);
  const lies:PuzzleLie[]=[
   {id:'A',witness:first,statementId:statementId(first,'opening'),kind:'D1',trueValue:arrivalTruth,falseValue:falseArrival,receiptId:'arrival-'+event.tokenId,inference:'The arrival receipt puts the move on a different day.',unlock:{receiptId:difficulty.sealed?'payment':null,line:'The arrival record fixes the time of the move.'}},
   {id:'B',witness:first,statementId:statementId(first,'followup'),kind:'I1',trueValue:paidValue,falseValue:subject.name+' moved as a gift',receiptId:'payment',inference:'Verified payment in the same transaction makes this a purchase.',unlock:{receiptId:null,line:'The payment record shows a '+route+'.'}},
  ];
  if(second!==null)lies.push({id:'C',witness:second,statementId:statementId(second,'followup'),kind:'D5',trueValue:priceValue,falseValue:subject.name+' was paid for with '+rounded(differentPriceBand(event.price!.grossWei!).toString(),event.price!.asset),receiptId:'payment',inference:'The payment receipt records a different amount.',unlock:{receiptId:null,line:'The price is recorded in the payment receipt.'}});
  for(const lie of lies){const statement=statements.find(row=>row.id===lie.statementId)!;statement.line='I saw '+lie.falseValue+'.';statement.claim={factId:lie.id==='A'?'arrival-'+event.tokenId:lie.id==='B'?'move-kind':'price',value:lie.falseValue};if(lie.id==='C'&&difficulty.chained)statement.requiresCaught=['B'];}
  return {statements,lies};
 };
 const tileInputs=[{label:subject.name,sources:[cutoff]},{label:route,sources:paymentSources},{label:price,sources:paymentSources},...cast.filter(member=>member.tokenId!==event.tokenId).map(member=>({label:member.name,sources:[member.arrival]}))];
 const tiles=tileInputs.map(row=>({id:hash(salt+':tile:'+row.label).slice(0,18),...row})).sort((a,b)=>hash(salt+a.id).localeCompare(hash(salt+b.id)));
 const file:PuzzleFile={v:2,id:'case-'+hash(candidate.id+':'+day).slice(2,26),day,mode,title:'The rain kept the receipt',setup:'A real sale moved '+subject.name+' to a new wallet. Find what the receipts say about the move.',type:candidate.type,subject:{tokenId:event.tokenId,name:subject.name},ruleLine:puzzleRule(day),opensAt,closesAt:opensAt+86400,cutoff,cast:castRows,receipts,tiles,blanks:[{id:'subject',label:'Chog'},{id:'move',label:'moved in a'},{id:'price',label:'for'}]};
 const plans:Record<string,PuzzlePlan>={default:makePlan(null)};for(const id of [primary,secondary])if(id!==null)plans[id]=makePlan(id);
 const puzzle:PuzzleCase={file,key:{v:2,caseId:file.id,salt,contentHash:hash(canonicalJSON(file)),receiptIds:receipts.map(row=>row.id),answers:{subject:tiles.find(row=>row.label===subject.name)!.id,move:tiles.find(row=>row.label===route)!.id,price:tiles.find(row=>row.label===price)!.id},plans},answerHash:''};
 puzzle.answerHash=puzzleHash(puzzle);
 const errors=validatePuzzle(puzzle);if(errors.length)return fail('CASE_PUZZLE_INVALID',errors.join(', '));return puzzle;
}

export function planFor(puzzle:PuzzleCase,detectiveId:number|null){return puzzle.key.plans[detectiveId===null?'default':String(detectiveId)]??puzzle.key.plans.default!;}
export function verifySalePuzzleSources(puzzle:PuzzleCase,input:Omit<Parameters<typeof buildSalePuzzle>[0],'day'|'salt'|'mode'>):boolean{
 try{
  if(validatePuzzle(puzzle).length)return false;
  const rebuilt=buildSalePuzzle({...input,day:puzzle.file.day,salt:puzzle.key.salt,mode:puzzle.file.mode});
  const facts=(item:PuzzleCase)=>({file:item.file,answers:item.key.answers,plans:Object.fromEntries(Object.entries(item.key.plans).map(([id,plan])=>[id,{lies:plan.lies,statements:plan.statements.map(({line,...statement})=>statement)}]))});
  return canonicalJSON(facts(puzzle))===canonicalJSON(facts(rebuilt));
 }catch{return false;}
}
export function validatePuzzle(puzzle:PuzzleCase):string[]{
 const errors=new Set<string>(),{file,key}=puzzle,difficulty=dailyDifficulty(file.day),add=(code:string)=>errors.add(code);
 if(!['DAILY','REPLAY'].includes(file.mode)||file.opensAt!==Date.parse(file.day+'T00:20:00Z')/1000||file.closesAt!==file.opensAt+86400)add('CASE_WINDOW');
 if(file.v!==2||key.v!==2||key.caseId!==file.id||!/^0x[a-f0-9]{64}$/i.test(key.salt)||key.contentHash!==hash(canonicalJSON(file))||puzzle.answerHash!==puzzleHash(puzzle))add('CASE_COMMITMENT');
 if(file.ruleLine!==puzzleRule(file.day)||file.cast.length!==difficulty.witnesses||new Set(file.cast.map(row=>row.tokenId)).size!==file.cast.length||file.cast.filter(row=>row.tokenId===file.subject.tokenId).length!==1)add('RULE_LINE_MISMATCH');
 if(file.receipts.length<4||file.receipts.length>6||new Set(file.receipts.map(row=>row.id)).size!==file.receipts.length||file.receipts.filter(row=>row.sealed).length!==difficulty.sealed)add('CASE_RECEIPTS');
 const sourceValid=(row:Source)=>/^0x[a-f0-9]{64}$/i.test(row.tx)&&Number.isSafeInteger(row.block)&&row.block>=0&&Number.isSafeInteger(row.logIndex)&&row.logIndex>=0&&(row.block<file.cutoff.block||row.block===file.cutoff.block&&(row.tx===file.cutoff.tx||row.logIndex<=file.cutoff.logIndex));
 for(const receipt of file.receipts)if(!receipt.text||!receipt.exactText||!Number.isSafeInteger(receipt.at)||receipt.at<0||receipt.at>=file.opensAt||!receipt.sources.length||receipt.sources.some(row=>!sourceValid(row))||!receipt.facts.length)add('CASE_RECEIPT_SOURCE');
 if(canonicalJSON(key.receiptIds)!==canonicalJSON(file.receipts.map(row=>row.id)))add('CASE_RECEIPT_KEY');
 if(file.tiles.length>config.solutionTileLimit||new Set(file.tiles.map(row=>row.id)).size!==file.tiles.length||new Set(file.tiles.map(row=>row.label)).size!==file.tiles.length||file.tiles.some(row=>!row.label||!row.sources.length||row.sources.some(source=>!sourceValid(source)))||file.blanks.length<3||file.blanks.length>4||new Set(file.blanks.map(row=>row.id)).size!==file.blanks.length||file.blanks.some(row=>!file.tiles.some(tile=>tile.id===key.answers[row.id]))||Object.keys(key.answers).length!==file.blanks.length)add('CASE_TILES');
 const baseline=key.plans.default;
 if(!baseline)return ['CASE_PLAN_MISSING'];
 for(const [protectedId,plan] of Object.entries(key.plans)){
  const witnessIds=new Set(file.cast.map(row=>row.tokenId)),liars=new Set(plan.lies.map(row=>row.witness));
  if(plan.lies.length!==difficulty.lies||liars.size!==difficulty.liars||plan.lies.some(row=>!witnessIds.has(row.witness))||plan.lies.find(row=>row.id==='A')?.witness!==plan.lies.find(row=>row.id==='B')?.witness||new Set(plan.lies.map(row=>row.id)).size!==plan.lies.length||difficulty.liars===2&&plan.lies.find(row=>row.id==='C')?.witness===plan.lies.find(row=>row.id==='A')?.witness)add('CASE_LIAR_PATTERN');
  if(protectedId!=='default'&&(!witnessIds.has(Number(protectedId))||liars.has(Number(protectedId))))add('CASE_OWN_DETECTIVE');
  if(plan.statements.length!==file.cast.length*2||new Set(plan.statements.map(row=>row.id)).size!==plan.statements.length)add('CASE_STATEMENTS');
  for(const statement of plan.statements){
   const lie=plan.lies.find(row=>row.statementId===statement.id),matches=file.receipts.filter(receipt=>receipt.facts.some(fact=>fact.id===statement.claim.factId));
   if(!witnessIds.has(statement.witness)||!['opening','followup'].includes(statement.slot)||statement.id!==statementId(statement.witness,statement.slot)||statement.line.length>140||!statement.line.startsWith('I ')||!statement.line.includes(statement.claim.value)||!matches.length||statement.requiresCaught.some(id=>!plan.lies.some(row=>row.id===id)))add('CASE_STATEMENT_FACT');
   if(validateLine({id:statement.id,card:'ARRIVAL',voice:'sharp',isLie:!!lie,cleanPersona:'',displayFacts:[statement.claim.value],trueFacts:[lie?.trueValue??statement.claim.value],sources:matches.flatMap(row=>row.sources)},{line:statement.line,facts_used:[statement.claim.value]}).length||/\bobjection\b/i.test(statement.line))add('CASE_STATEMENT_WORDS');
   if(lie){
    if(lie.witness!==statement.witness||lie.falseValue!==statement.claim.value||lie.falseValue===lie.trueValue||!lie.inference||!lie.unlock.line||matches.length!==1||matches[0]!.id!==lie.receiptId||!matches[0]!.facts.some(fact=>fact.id===statement.claim.factId&&fact.value===lie.trueValue)||lie.unlock.receiptId!==null&&!file.receipts.some(row=>row.id===lie.unlock.receiptId))add('CASE_CONTRADICTION');
   }else if(matches.some(receipt=>receipt.facts.some(fact=>fact.id===statement.claim.factId&&fact.value!==statement.claim.value)))add('CASE_TRUE_STATEMENT');
  }
  const first=plan.lies.find(row=>row.id==='A'),second=plan.lies.find(row=>row.id==='B');
  if(!first||!second||plan.statements.find(row=>row.id===first.statementId)?.slot!=='opening'||plan.statements.find(row=>row.id===first.statementId)?.requiresCaught.length||file.receipts.find(row=>row.id===first.receiptId)?.sealed||plan.statements.find(row=>row.id===second.statementId)?.slot!=='followup')add('CASE_DISCOVERY');
  if(difficulty.chained){const third=plan.lies.find(row=>row.id==='C');if(!third||!plan.statements.find(row=>row.id===third.statementId)?.requiresCaught.includes('B'))add('CASE_DISCOVERY');}
  for(const lie of plan.lies)if(file.receipts.some(row=>row.text.includes(lie.falseValue)||row.exactText.includes(lie.falseValue))||file.setup.includes(lie.falseValue)||file.tiles.some(row=>row.label.includes(lie.falseValue)))add('CASE_FALSE_VALUE_LEAK');
  if(protectedId!=='default')for(const lie of plan.lies){const original=baseline.lies.find(row=>row.id===lie.id);if(!original||original.kind!==lie.kind||original.trueValue!==lie.trueValue||original.falseValue!==lie.falseValue||original.receiptId!==lie.receiptId)add('CASE_ALTERNATE_FACTS');}
 }
 for(const witness of new Set(baseline.lies.map(row=>row.witness)))if(!key.plans[witness])add('CASE_ALTERNATE_MISSING');
 return [...errors];
}
