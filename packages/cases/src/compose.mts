import {keccak256,toBytes} from 'viem';
import {canonicalJSON} from './build.mts';
import {buildSalePuzzle,dailyDifficulty,puzzleHash,validatePuzzle,speak,PuzzleError,type PuzzleCase,type PuzzleReceipt,type LieId,type LieKind} from './puzzle.mts';
import {ClaimCatalog,noirWalletLabels,type ClaimCandidate,type BulkSource} from '../../witness/src/claims.mts';
import type {OwnerSnapshot} from '../../auth/src/holders.mts';
import {provePuzzleSolvable} from '../../solver/src/solve.mts';

type SaleInput=Parameters<typeof buildSalePuzzle>[0];
interface ReceiptGroup {receipt:PuzzleReceipt;dates:Set<number>;owners:Set<number>;payments:Set<number>}
const hash=(value:string)=>keccak256(toBytes(value));
const sourceKey=(row:{tx:string;logIndex:number})=>row.tx.toLowerCase()+':'+row.logIndex;
const overlaps=(a:Set<number>,b:Set<number>)=>[...a].some(id=>b.has(id));

export function catalogForPuzzle(base:PuzzleCase,input:Omit<SaleInput,'day'|'salt'|'mode'|'candidate'>&{ownership:OwnerSnapshot;bulkSources?:readonly BulkSource[]}){
 const ids=new Set(base.file.cast.map(row=>row.tokenId)),rows=input.history.filter(row=>row.event.block<base.file.cutoff.block||row.event.block===base.file.cutoff.block&&row.event.logIndex<=base.file.cutoff.logIndex).sort((a,b)=>a.event.block-b.event.block||a.event.logIndex-b.event.logIndex);
 const labels=noirWalletLabels(rows.filter(row=>ids.has(row.event.tokenId)).flatMap(row=>[row.event.from,row.event.to]),base.key.salt),current=new Map<number,string>();
 for(const row of rows)if(row.event.from!==row.event.to)current.set(row.event.tokenId,row.event.to);
 for(const member of base.file.cast)labels.set(current.get(member.tokenId)!,member.nickname);
 return new ClaimCatalog({history:input.history,times:input.times,metadata:input.metadata,ownership:input.ownership,cutoff:base.file.cutoff,walletLabels:labels,...(input.bulkSources?{bulkSources:input.bulkSources}:{})});
}

/** Merge supporting facts into one card when they would prove the same contradiction. */
export function composePuzzle(base:PuzzleCase,candidates:readonly ClaimCandidate[],selection:Partial<Record<LieId,string>>):PuzzleCase{
 if(validatePuzzle(base).length)throw new PuzzleError('CASE_BASE_INVALID','The source sale puzzle is invalid.');
 const puzzle=structuredClone(base),difficulty=dailyDifficulty(puzzle.file.day),chosen=new Map<LieId,ClaimCandidate>();
 for(const id of ['A','B',...(difficulty.lies===3?['C']:[])] as LieId[]){const claim=candidates.find(row=>row.id===selection[id]);if(!claim||!puzzle.file.cast.some(row=>row.tokenId===claim.tokenId)||id==='A'&&!claim.kind.startsWith('D')||id==='B'&&!claim.kind.startsWith('I'))throw new PuzzleError('CASE_CLAIM_UNAVAILABLE','Choose a proven claim of the required kind.');chosen.set(id,claim);}
 if(new Set([...chosen.values()].map(row=>row.id)).size!==chosen.size||Object.keys(selection).length!==chosen.size)throw new PuzzleError('CASE_CLAIM_REPEATED','Each lie needs its own selected claim.');
 const subject=puzzle.file.subject.tokenId,arrival=structuredClone(puzzle.file.receipts.find(row=>row.id==='arrival-'+subject)!),payment=structuredClone(puzzle.file.receipts.find(row=>row.id==='payment')!);
 arrival.tokenIds=[subject];payment.tokenIds=[subject];
 const group=(receipt:PuzzleReceipt,dates:number[]=[],owners:number[]=[],payments:number[]=[]):ReceiptGroup=>({receipt,dates:new Set(dates),owners:new Set(owners),payments:new Set(payments)});
 const groups:ReceiptGroup[]=[group(arrival,[subject]),group(payment,[],[],[subject])];
 const merge=(target:ReceiptGroup,incoming:ReceiptGroup)=>{
  const receipt=target.receipt,other=incoming.receipt;
  if(!receipt.text.includes(other.text))receipt.text+=' '+other.text;if(!receipt.exactText.includes(other.exactText))receipt.exactText+=' '+other.exactText;
  receipt.sources=[...new Map([...receipt.sources,...other.sources].map(row=>[sourceKey(row),row])).values()].sort((a,b)=>a.block-b.block||a.logIndex-b.logIndex);
  for(const fact of other.facts){const known=receipt.facts.find(row=>row.id===fact.id);if(known&&known.value!==fact.value)throw new PuzzleError('CASE_FACT_CONFLICT','Receipt facts disagree.');if(!known)receipt.facts.push(fact);}
  receipt.tokenIds=[...new Set([...(receipt.tokenIds??[]),...(other.tokenIds??[])])];receipt.at=Math.max(receipt.at,other.at);
  for(const field of ['dates','owners','payments'] as const)for(const id of incoming[field])target[field].add(id);
 };
 for(const claim of chosen.values()){
  const receipt=structuredClone(claim.receipt);receipt.tokenIds=[...new Set([claim.tokenId,...claim.relatedTokenIds])];
  const dates=claim.kind==='D1'?[claim.tokenId]:claim.kind==='I2'?[claim.tokenId,...claim.relatedTokenIds]:[],owners=['D3','D4','D6','I4'].includes(claim.kind)?[claim.tokenId]:[],payments=['D2','D5','I1'].includes(claim.kind)?[claim.tokenId]:[];
  const incoming=group(receipt,dates,owners,payments),matches=groups.filter(row=>overlaps(row.dates,incoming.dates)||overlaps(row.owners,incoming.owners)||overlaps(row.payments,incoming.payments));
  if(!matches.length)groups.push(incoming);
  else{const target=matches[0]!;merge(target,incoming);for(const other of matches.slice(1)){merge(target,other);groups.splice(groups.indexOf(other),1);}}
 }
 // Every cast member retains a free receipt about itself for its own holder.
 for(const member of puzzle.file.cast)if(!groups.some(row=>row.receipt.tokenIds?.includes(member.tokenId))){const receipt=structuredClone(base.file.receipts.find(row=>row.id==='arrival-'+member.tokenId)!);receipt.tokenIds=[member.tokenId];groups.push(group(receipt,[member.tokenId]));}
 for(const receipt of base.file.receipts){
  if(groups.length>=4)break;
  const token=receipt.id.startsWith('arrival-')?Number(receipt.id.slice('arrival-'.length)):null;
  if(token!==null&&!groups.some(row=>row.dates.has(token))){const saved=structuredClone(receipt);saved.tokenIds=[token];groups.push(group(saved,[token]));}
 }
 for(const claim of [...candidates].sort((a,b)=>a.id.localeCompare(b.id))){
  if(groups.length>=4)break;
  const dates=claim.kind==='D1'?[claim.tokenId]:claim.kind==='I2'?[claim.tokenId,...claim.relatedTokenIds]:[],owners=['D3','D4','D6','I4'].includes(claim.kind)?[claim.tokenId]:[],payments=['D2','D5','I1'].includes(claim.kind)?[claim.tokenId]:[];
  if(!dates.length&&!owners.length&&!payments.length)continue;
  const receipt=structuredClone(claim.receipt);receipt.tokenIds=[claim.tokenId,...claim.relatedTokenIds];const extra=group(receipt,dates,owners,payments);
  if(!groups.some(row=>overlaps(row.dates,extra.dates)||overlaps(row.owners,extra.owners)||overlaps(row.payments,extra.payments)))groups.push(extra);
 }
 if(groups.length<4||groups.length>6)throw new PuzzleError('CASE_RECEIPT_LIMIT','This claim combination needs a different set of receipts.');
 const proofFor=(claim:ClaimCandidate)=>groups.find(row=>row.receipt.facts.some(fact=>fact.id===claim.factId))!.receipt;
 const firstReceipt=proofFor(chosen.get('A')!),secondReceipt=proofFor(chosen.get('B')!);
 for(const row of groups)row.receipt.sealed=false;
 const sealed=difficulty.sealed?(secondReceipt.id!==firstReceipt.id?secondReceipt:groups.find(row=>row.receipt.id!==firstReceipt.id)!.receipt):null;
 if(sealed)sealed.sealed=true;
 const arrivalFact=arrival.facts.find(row=>row.id==='arrival-'+subject)!,paymentFact=payment.facts.find(row=>row.id==='move-kind')!;
 puzzle.file.receipts=groups.map(row=>row.receipt);
 for(const plan of Object.values(puzzle.key.plans)){
  for(const statement of plan.statements){const fact=statement.slot==='opening'?arrivalFact:paymentFact;statement.claim={factId:fact.id,value:fact.value};statement.line=speak(puzzle.file,puzzle.key.salt,statement.witness,fact.value,statement.slot,statement.id);statement.requiresCaught=[];}
  for(const lie of plan.lies){
   const claim=chosen.get(lie.id)!,receipt=proofFor(claim),statement=plan.statements.find(row=>row.id===lie.statementId)!;
   Object.assign(lie,{kind:claim.kind,trueValue:claim.trueValue,falseValue:claim.falseValue,receiptId:receipt.id,inference:claim.inference,unlock:{receiptId:lie.id==='A'?sealed?.id??null:null,line:claim.unlockLine}});
   statement.claim={factId:claim.factId,value:claim.falseValue};statement.line=speak(puzzle.file,puzzle.key.salt,statement.witness,claim.falseValue,statement.slot,statement.id);lie.retraction=speak(puzzle.file,puzzle.key.salt,statement.witness,claim.trueValue,'retraction',statement.id);if(lie.id==='C'&&difficulty.chained)statement.requiresCaught=['B'];
  }
 }
 puzzle.key.claimIds={...selection};puzzle.key.receiptIds=puzzle.file.receipts.map(row=>row.id);puzzle.key.contentHash=hash(canonicalJSON(puzzle.file));puzzle.answerHash=puzzleHash(puzzle);
 const errors=validatePuzzle(puzzle);if(errors.length)throw new PuzzleError('CASE_COMPOSITION_INVALID',errors.join(', '));return puzzle;
}

export function selectClaimPuzzle(base:PuzzleCase,catalog:ClaimCatalog,kinds:Partial<Record<LieId,LieKind>>={}){
 if(canonicalJSON(catalog.cutoff)!==canonicalJSON(base.file.cutoff))throw new PuzzleError('CASE_CUTOFF_MISMATCH','Claims must use the case cutoff.');
 const ids=base.file.cast.map(row=>row.tokenId),candidates=ids.flatMap(id=>catalog.forToken(id,ids).claims),ordered=[...candidates].sort((a,b)=>hash(base.key.salt+':'+a.id).localeCompare(hash(base.key.salt+':'+b.id)));
 const direct=ordered.filter(row=>row.kind.startsWith('D')&&(!kinds.A||row.kind===kinds.A)),inference=ordered.filter(row=>row.kind.startsWith('I')&&(!kinds.B||row.kind===kinds.B)),third=dailyDifficulty(base.file.day).lies===3?ordered.filter(row=>!kinds.C||row.kind===kinds.C):[null];
 for(const first of direct)for(const second of inference)for(const extra of third){
  if(extra&&(extra.id===first.id||extra.id===second.id))continue;
  try{const puzzle=composePuzzle(base,candidates,{A:first.id,B:second.id,...(extra?{C:extra.id}:{})});const proof=provePuzzleSolvable(puzzle);return {puzzle,proof,candidates};}
  catch(error){if(!(error instanceof PuzzleError)||!['CASE_RECEIPT_LIMIT','CASE_COMPOSITION_INVALID'].includes(error.code))throw error;}
 }
 throw new PuzzleError('CASE_UNSOLVABLE','No source-backed claim combination fits this cast and receipt limit.');
}

export function verifyComposedPuzzleSources(puzzle:PuzzleCase,input:SaleInput,catalog:ClaimCatalog){
 try{
  if(validatePuzzle(puzzle).length||!puzzle.key.claimIds||input.day!==puzzle.file.day||input.salt!==puzzle.key.salt||input.mode!==puzzle.file.mode||canonicalJSON(catalog.cutoff)!==canonicalJSON(puzzle.file.cutoff))return false;
  const base=buildSalePuzzle(input),ids=base.file.cast.map(row=>row.tokenId),claims=ids.flatMap(id=>catalog.forToken(id,ids).claims),rebuilt=composePuzzle(base,claims,puzzle.key.claimIds);
  const facts=(item:PuzzleCase)=>({file:item.file,answers:item.key.answers,claimIds:item.key.claimIds,plans:Object.fromEntries(Object.entries(item.key.plans).map(([id,plan])=>[id,{lies:plan.lies,statements:plan.statements.map(({line,...statement})=>statement)}]))});
  return canonicalJSON(facts(puzzle))===canonicalJSON(facts(rebuilt));
 }catch{return false;}
}
