import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {encodeDeployData,encodeAbiParameters,isAddress,type Address,type Hex} from 'viem';
import {loadEnv} from './env.mts';
import {transactionWriter} from '../packages/chain/src/client.mts';
import {atomicJSON} from '../packages/publishing/src/vault.mts';
import {verifyCasebookSource} from '../packages/chain/src/source.mts';
await loadEnv();
const root=fileURLToPath(new URL('../',import.meta.url)),command=process.argv[2]??'status';
await mkdir(join(root,'runs/chain'),{recursive:true,mode:0o700});
async function activate(address:string){let env=await readFile(join(root,'.env'),'utf8');env=/^CASEBOOK_ADDRESS=.*$/m.test(env)?env.replace(/^CASEBOOK_ADDRESS=.*$/m,`CASEBOOK_ADDRESS=${address}`):env+`\nCASEBOOK_ADDRESS=${address}\n`;await writeFile(join(root,'.env'),env,{mode:0o600});}
if(command==='status'){
 console.log(JSON.stringify({chainId:143,address:process.env.CASEBOOK_ADDRESS&&isAddress(process.env.CASEBOOK_ADDRESS)?process.env.CASEBOOK_ADDRESS:null,signerConfigured:!!process.env.SERVER_PRIVATE_KEY,writesEnabled:process.env.EXECUTION_WRITES_ENABLED==='true',note:'Keys stay local. This command does not submit a transaction.'},null,2));
}else if(command==='deploy'){
 if(process.env.CHOG_CHAIN_LOCKED!=='true')throw new Error('CHAIN_LOCK: Use corepack pnpm chain:deploy so the writer lock is held');
 const writer=await transactionWriter(root,{maxCostWei:1_000_000_000_000_000_000n});
 const manifestPath=join(root,'runs/chain/deployment.json');
 try{const saved=JSON.parse(await readFile(manifestPath,'utf8'));if(saved.sourceVerification?.status!=='PASS'){saved.sourceVerification=await verifyCasebookSource(root,saved.address,saved.owner);await atomicJSON(manifestPath,saved);}await activate(saved.address);console.log(JSON.stringify({status:'ALREADY_DEPLOYED_AND_VERIFIED',...saved}));process.exit(0);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 await promisify(execFile)('/home/ubuntu/.foundry/bin/forge',['build'],{cwd:join(root,'contracts')});
 const artifact=JSON.parse(await readFile(join(root,'contracts/out/CaseBook.sol/CaseBook.json'),'utf8'));
 const data=encodeDeployData({abi:artifact.abi,bytecode:artifact.bytecode.object as Hex,args:[writer.account.address]});
 const receipt=await writer.send('casebook-deployment',data,null);
 const bytecode=await writer.client.getBytecode({address:receipt.address});
 if(bytecode?.toLowerCase()!==artifact.deployedBytecode.object.toLowerCase())throw new Error('CHAIN_CODE: Deployed runtime differs from the compiled source');
 const manifest={address:receipt.address,chainId:143,owner:writer.account.address,receipt,compiler:artifact.metadata?.compiler?.version??'0.8.30',source:'contracts/src/CaseBook.sol'};
 await atomicJSON(manifestPath,manifest);
 const sourceVerification=await verifyCasebookSource(root,receipt.address,writer.account.address);await atomicJSON(manifestPath,{...manifest,sourceVerification});await activate(receipt.address);
 console.log(JSON.stringify({status:'DEPLOYED_AND_VERIFIED',...manifest,sourceVerification},null,2));
}else if(command==='verify-source'){
 const path=join(root,'runs/chain/deployment.json'),manifest=JSON.parse(await readFile(path,'utf8'));
 const address=(process.env.CASEBOOK_ADDRESS??manifest.address) as Address;if(!address||!isAddress(address))throw new Error('CHAIN_ADDRESS: Deploy CaseBook first');
 const sourceVerification=await verifyCasebookSource(root,address,manifest.owner);await atomicJSON(path,{...manifest,sourceVerification});await activate(address);console.log(JSON.stringify(sourceVerification,null,2));
}else throw new Error('CHAIN_COMMAND: status, deploy or verify-source');
