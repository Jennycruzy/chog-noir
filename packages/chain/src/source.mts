import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {encodeAbiParameters,keccak256,toBytes,type Address} from 'viem';
import {setTimeout as pause} from 'node:timers/promises';
export async function verifyCasebookSource(root:string,address:Address,owner:Address){
 const key=process.env.ETHERSCAN_API_KEY;if(!key)throw new Error('SOURCE_KEY: Configure the explorer API key locally');
 const artifact=JSON.parse(await readFile(join(root,'contracts/out/CaseBook.sol/CaseBook.json'),'utf8'));
 const metadata=typeof artifact.metadata==='string'?JSON.parse(artifact.metadata):artifact.metadata;
 const target=Object.keys(metadata.settings.compilationTarget)[0]!,source=await readFile(join(root,'contracts',target),'utf8');
 if(keccak256(toBytes(source))!==metadata.sources[target].keccak256)throw new Error('SOURCE_ARTIFACT: Source changed since the verified compilation');
 const {compilationTarget:_target,...settings}=metadata.settings;
 const input={language:'Solidity',sources:{[target]:{content:source}},settings:{...settings,outputSelection:{'*':{'*':['abi','evm.bytecode','evm.deployedBytecode','metadata']}}}};
 const endpoint=new URL('https://api.etherscan.io/v2/api');endpoint.searchParams.set('chainid','143');endpoint.searchParams.set('apikey',key);
 async function query(parameters:Record<string,string>){
  let response:Response;try{response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({module:'contract',...parameters}),signal:AbortSignal.timeout(30_000)});}catch{throw new Error('SOURCE_NETWORK: Explorer verification is unavailable; deployment is preserved');}
  if(!response.ok)throw new Error('SOURCE_HTTP: Explorer verification request failed');return response.json() as Promise<{status:string;message:string;result:string}>;
 }
 const compiler='v'+String(metadata.compiler.version).replace(/^v/,'');
 const submission=await query({action:'verifysourcecode',contractaddress:address,sourceCode:JSON.stringify(input),codeformat:'solidity-standard-json-input',contractname:`${target}:CaseBook`,compilerversion:compiler,optimizationUsed:'1',runs:'200',constructorArguments:encodeAbiParameters([{type:'address'}],[owner]).slice(2),evmVersion:'paris',licenseType:'3'});
 if(submission.status!=='1'){
  if(/already verified/i.test(submission.result))return {status:'PASS',address,compiler,checkedAt:new Date().toISOString(),note:'Explorer already has verified source'};
  throw new Error('SOURCE_SUBMISSION: Explorer did not accept source verification; deployment receipt is preserved');
 }
 for(let attempt=0;attempt<30;attempt++){
  const result=await query({action:'checkverifystatus',guid:submission.result});
  if(result.status==='1'||/already verified/i.test(result.result))return {status:'PASS',address,compiler,checkedAt:new Date().toISOString(),guid:submission.result};
  if(!/pending|queue|processing/i.test(result.result))throw new Error('SOURCE_FAILED: Explorer verification failed; review the saved deployment and compiled source');
  await pause(3000);
 }
 throw new Error('SOURCE_PENDING: Explorer verification remains queued; rerun chain:verify-source');
}
