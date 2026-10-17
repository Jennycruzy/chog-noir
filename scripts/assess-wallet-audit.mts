import {readFile,readdir,writeFile} from 'node:fs/promises';
import {decodeAbiParameters,parseAbiParameters} from 'viem';
import {assessRecord,assessSymbol,type RecordInput,type CodeProof} from '../packages/detector/src/records.mts';
import {verifyFindingSources,type RpcEvidence} from '../packages/detector/src/evidence.mts';
const root=new URL('../data/wallet-audit/',import.meta.url);
const scan=JSON.parse(await readFile(new URL('report.json',root),'utf8'));
const rows=JSON.parse(await readFile(new URL('candidates.json',root),'utf8')) as RecordInput[];
const symbols=JSON.parse(await readFile(new URL('all-token-symbols.json',root),'utf8')) as {address:string;count:number;fetchedAt:string;reply:{result?:`0x${string}`;error?:unknown}}[];
const registry=JSON.parse(await readFile(new URL('../config/reference-tokens.json',import.meta.url),'utf8')) as {assets:Record<string,string[]>;source:string;fetchedAt:string};
const proofs=new Map<string,CodeProof>();
for(const file of await readdir(new URL('proofs/',root))){
 const saved=JSON.parse(await readFile(new URL(`proofs/${file}`,root),'utf8'));
 const pre=saved.replies.find((reply:{id:number})=>reply.id===1)?.result;
 proofs.set(saved.address,{address:saved.address,historicalCode:pre?.[saved.address]?.code??null,currentCode:saved.replies.find((reply:{id:number})=>reply.id===3)?.result??'0x',fetchedAt:saved.fetchedAt,exampleTx:saved.example});
}
const wallets=new Set<string>(JSON.parse(await readFile(new URL('wallets.json',root),'utf8')));
const findings=[];
const sourceChecks:{tx:string;logIndex:number;errors:string[]}[]=[];
for(const input of rows){
 let proof:CodeProof|undefined;
 try{
  let saved;
  try{saved=JSON.parse(await readFile(new URL(`transaction-proofs-goldsky/${input.tx.hash}.json`,root),'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;saved=JSON.parse(await readFile(new URL(`transaction-proofs/${input.tx.hash}.json`,root),'utf8'));}
  const historicalCode=saved.reply.result?.[input.log.address.toLowerCase()]?.code;
  const reference=proofs.get(input.log.address.toLowerCase());
  if(reference&&historicalCode)proof={...reference,historicalCode,exampleTx:input.tx.hash,fetchedAt:saved.fetchedAt};
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const result=wallets.has('0x'+input.log.topics[1]!.slice(-40))?assessRecord(input,'0x'+input.log.topics[1]!.slice(-40),proof):{status:'NOT_AUDITED_SENDER'};
 findings.push({tx:input.tx.hash,logIndex:input.log.logIndex,token:input.log.address,result});
 if(result.status==='SYNTHETIC_RECORD'&&'proof' in result){
  let errors:string[];
  try{
   const execution=JSON.parse(await readFile(new URL(`transaction-proofs-goldsky/${input.tx.hash}.json`,root),'utf8')) as RpcEvidence;
   const receipt=JSON.parse(await readFile(new URL(`transaction-proofs-goldsky/receipt-${input.tx.hash}.json`,root),'utf8')) as RpcEvidence;
   errors=verifyFindingSources(input,result.proof!.codeHash,execution,receipt);
  }catch{errors=['SOURCE_UNAVAILABLE'];}
  sourceChecks.push({tx:input.tx.hash,logIndex:input.log.logIndex,errors});
 }
}
const symbolFindings=symbols.map(item=>{
 let symbol:string;
 try{if(!item.reply.result)throw new Error();symbol=decodeAbiParameters(parseAbiParameters('string'),item.reply.result)[0];}
 catch{return {address:item.address,records:item.count,status:'SYMBOL_UNAVAILABLE',fetchedAt:item.fetchedAt};}
 return {address:item.address,records:item.count,fetchedAt:item.fetchedAt,...assessSymbol(item.address,symbol,registry.assets)};
});
const legitimate=new Set(['0x3a2c4aaae6776dc1c31316de559598f2f952e2cb','0xa3227c5969757783154c60bf0bc1944180ed81b9','0x1b68626dca36c7fe922fd2d55e4f631d962de19c']);
const legitimateRegressions=findings.filter(row=>legitimate.has(row.token.toLowerCase()));
const falsePositives=legitimateRegressions.filter(row=>row.result.status==='SYNTHETIC_RECORD').length;
const total=symbols.reduce((sum,item)=>sum+item.count,0);
const executionProofAudit=JSON.parse(await readFile(new URL('transaction-proofs/summary.json',root),'utf8'));
const receiptAudit=JSON.parse(await readFile(new URL('transaction-proofs-goldsky/receipts-summary.json',root),'utf8'));
let archiveProofAudit=null;
try{archiveProofAudit=JSON.parse(await readFile(new URL('transaction-proofs-goldsky/summary.json',root),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
if(total!==scan.erc20Transfers||rows.length!==scan.candidateCount||legitimateRegressions.length!==6)throw new Error('DETECTOR_COVERAGE: Dataset or regression population changed');
const report={checkedAt:new Date().toISOString(),scope:scan,startTime:scan.startTime,endTimeInclusive:scan.endTimeInclusive,
 status:sourceChecks.length>0&&sourceChecks.every(check=>check.errors.length===0)&&falsePositives===0?'PASS_PROOF_ONLY_SCOPE':'REVIEW_REQUIRED',tokens:symbols.length,erc20Transfers:total,signerCandidates:rows.length,
 senderScopedCandidates:findings.filter(row=>row.result.status!=='NOT_AUDITED_SENDER').length,executionProofAudit,archiveProofAudit,receiptAudit,
 syntheticRecords:findings.filter(row=>row.result.status==='SYNTHETIC_RECORD').length,
 unprovenCandidates:findings.filter(row=>row.result.status==='REVIEW').length,
 legitimateRegressionRecords:legitimateRegressions.length,falsePositivesOnReviewedLegitimateRecords:falsePositives,
 precisionAudit:{acceptedFindings:sourceChecks.length,receiptAndExecutionVerified:sourceChecks.filter(check=>check.errors.length===0).length,unsupportedFindings:sourceChecks.filter(check=>check.errors.length>0),reviewCandidatesExcluded:true},
 lookalikeTokens:symbolFindings.filter(item=>item.status==='LOOKALIKE'),symbolUnavailable:symbolFindings.filter(item=>item.status==='SYMBOL_UNAVAILABLE').length,
 registry:{source:registry.source,fetchedAt:registry.fetchedAt},
 note:'Precision is evaluated for the proof-only detector over the collected 30-day corpus: every accepted synthetic-record finding must match a successful second-provider receipt and that transaction’s execution-time code, with no state access or external execution. Unproven candidates remain REVIEW and are never described as forged. This does not claim perfect recall, resolution of every suspicious record, or accuracy beyond the checked window. Six ordinary receiver-side regressions are excluded before sender detection.'};
await writeFile(new URL('assessments.json',root),JSON.stringify({findings,symbolFindings,sourceChecks}));
await writeFile(new URL('../docs/audit/evidence/M0-detector-review-20261017.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({tokens:report.tokens,transfers:total,syntheticRecords:report.syntheticRecords,unproven:report.unprovenCandidates,legitimateRegressions:legitimateRegressions.length,falsePositives,lookalikeTokens:report.lookalikeTokens.length,symbolUnavailable:report.symbolUnavailable,status:report.status},null,2));
