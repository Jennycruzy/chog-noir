import {loadEnv} from './env.mts';
import {verifyPuzzlePublication} from '../packages/chain/src/verify.mts';
// Independent check of a published case from its public pages and the chain alone: no private file is read.
await loadEnv();const id=process.argv[2];
if(!id||!/^case-[a-f0-9]{24}$/.test(id))throw new Error('VERIFY_INPUT: Supply a case id, for example case-0123456789abcdef01234567');
const origin=(process.env.PUBLIC_API_BASE??'https://chognoir.54-154-121-30.sslip.io').replace(/\/$/,'');
const response=await fetch(origin+'/api/case/'+encodeURIComponent(id)+'/public',{signal:AbortSignal.timeout(30_000)});
if(!response.ok){console.log(JSON.stringify({status:'NOT_PUBLISHED',caseId:id}));process.exit(1);}
const data=await response.json(),summary=data.case;
const record={id,contract:summary.contract,answerHash:summary.answerHash,opensAt:summary.opensAt,closesAt:summary.closesAt,publishedAt:summary.publishedAt,
 open:summary.openTx?{hash:summary.openTx}:null,close:summary.closeTx?{hash:summary.closeTx}:null} as Parameters<typeof verifyPuzzlePublication>[0];
const result=await verifyPuzzlePublication(record,data.file??null);
console.log(JSON.stringify(result,null,2));if(result.status!=='PASS'&&result.status!=='COMMITMENT_VERIFIED')process.exitCode=1;
