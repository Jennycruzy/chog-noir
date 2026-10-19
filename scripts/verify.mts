import {fileURLToPath} from 'node:url';
import {loadEnv} from './env.mts';
import {privateVaultKeyFile} from '../packages/publishing/src/vault.mts';
import {publishedCases} from '../apps/api/src/publications.mts';
import {verifyPublication} from '../packages/chain/src/verify.mts';
await loadEnv();const id=process.argv[2];
if(!id||!/^\d{4}-\d{2}-\d{2}-(main|cold)$/.test(id))throw new Error('VERIFY_INPUT: Supply a daily case ID, for example 2026-10-19-main');
const {records,drafts}=await publishedCases(fileURLToPath(new URL('../',import.meta.url)),privateVaultKeyFile());
let record=records.find(item=>item.id===id),draft=drafts.find(item=>item.public.id===id);
if(!record||!draft){const origin=process.env.PUBLIC_API_BASE??'https://chognoir.54-154-121-30.sslip.io';const response=await fetch(origin.replace(/\/$/,'')+'/api/publications/'+encodeURIComponent(id)+'/bundle',{signal:AbortSignal.timeout(30_000)});if(response.ok){const bundle=await response.json();record=bundle.publication;draft={public:bundle.case,private:{key:bundle.key,salt:bundle.salt,...(bundle.facts?{facts:bundle.facts}:{})}};}}
if(!record||!draft){console.log(JSON.stringify({status:'NOT_PUBLISHED',caseId:id}));process.exitCode=1;}
else{const result=await verifyPublication(record,draft);console.log(JSON.stringify(result,null,2));if(result.status!=='PASS')process.exitCode=1;}
