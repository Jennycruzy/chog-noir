import {createPublicClient,defineChain,http,encodeFunctionData,keccak256,toHex,type Hex,type Address} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {casebookAbi,chainCaseId,encodedKey,type CaseChain,type ChainReceipt} from './casebook.mts';
import type {CaseDraft} from '../../cases/src/build.mts';
import {atomicJSON} from '../../publishing/src/vault.mts';
export const monad=defineChain({id:143,name:'Monad',nativeCurrency:{name:'Monad',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://rpc.monad.xyz']}}});
export interface SignedJournal {v:1;hash:Hex;raw:Hex;nonce:number;chainId:143;to:Address|null;data:Hex;receipt:ChainReceipt|null}
export async function transactionWriter(root:string,options:{url?:string;key?:string;enabled?:boolean;address?:Address;maxCostWei?:bigint}={}){
 const client=createPublicClient({chain:monad,transport:http(options.url??process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz',{timeout:30_000,retryCount:2})});
 if(await client.getChainId()!==143)throw new Error('CHAIN_NETWORK: Monad mainnet required');
 const key=options.key??process.env.SERVER_PRIVATE_KEY,enabled=options.enabled??process.env.EXECUTION_WRITES_ENABLED==='true';
 if(!enabled||!key||!/^0x[0-9a-f]{64}$/i.test(key))throw new Error('CHAIN_NOT_CONFIGURED: Set the server signing key and explicit write switch locally');
 const account=privateKeyToAccount(key as Hex),directory=join(root,'runs/chain/transactions');await mkdir(directory,{recursive:true,mode:0o700});
 let tail=Promise.resolve();
 const send=async(label:string,data:Hex,to:Address|null,addressForReceipt?:Address):Promise<ChainReceipt>=>{
  if(!/^[a-z0-9-]+$/.test(label))throw new Error('CHAIN_LABEL');
  const previous=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await previous;
  try{
   const path=join(directory,label+'.json');let journal:SignedJournal|null=null;
   try{journal=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(journal&&(journal.to?.toLowerCase()!==to?.toLowerCase()||journal.data!==data||journal.chainId!==143))throw new Error('CHAIN_JOURNAL_CONFLICT: Refusing changed transaction intent');
   if(journal?.receipt){const canonical=await client.getBlock({blockNumber:BigInt(journal.receipt.blockNumber)});if(canonical.hash!==journal.receipt.blockHash)throw new Error('CHAIN_REORG: Saved receipt is no longer canonical');return journal.receipt;}
   if(!journal){
    const gas=await client.estimateGas({account,...(to?{to}:{}),data,value:0n});
    const gasPrice=await client.getGasPrice(),maximum=options.maxCostWei??100_000_000_000_000_000n;
    if(gas*gasPrice>maximum)throw new Error('CHAIN_GAS_CAP: Estimated gas exceeds the configured operation cap');
    if(await client.getBalance({address:account.address})<gas*gasPrice)throw new Error('CHAIN_GAS_BALANCE: Fund the server wallet with gas MON');
    const nonce=await client.getTransactionCount({address:account.address,blockTag:'pending'});
    const raw=await account.signTransaction({chainId:143,type:'legacy',nonce,gas,gasPrice,...(to?{to}:{}),data,value:0n});
    journal={v:1,hash:keccak256(raw),raw,nonce,chainId:143,to,data,receipt:null};await atomicJSON(path,journal);
   }
   let receipt=await client.getTransactionReceipt({hash:journal.hash}).catch(()=>null);
   if(!receipt){
    try{const hash=await client.sendRawTransaction({serializedTransaction:journal.raw});if(hash!==journal.hash)throw new Error('CHAIN_HASH: Broadcast hash differs');}
    catch(error){
     // A lost acknowledgement must not cause another signed transaction. If the
     // same hash is not known, the next run rebroadcasts these same saved bytes.
     const known=await client.getTransaction({hash:journal.hash}).catch(()=>null);
     if(!known)throw new Error('CHAIN_BROADCAST_UNCERTAIN: Saved transaction will be retried; no replacement was signed');
    }
    receipt=await client.waitForTransactionReceipt({hash:journal.hash,confirmations:2,timeout:120_000});
   }
   if(receipt.status!=='success')throw new Error('CHAIN_REVERTED: Saved transaction reverted; manual review required');
   const deadline=Date.now()+120_000;
   while((await client.getBlock({blockTag:'finalized'})).number<receipt.blockNumber){if(Date.now()>deadline)throw new Error('CHAIN_FINALITY: Transaction is not finalized yet; saved bytes will be resumed');await new Promise(resolve=>setTimeout(resolve,1000));}
   const block=await client.getBlock({blockNumber:receipt.blockNumber});
   if(block.hash!==receipt.blockHash)throw new Error('CHAIN_REORG: Receipt block changed');
   const address=addressForReceipt??receipt.contractAddress??options.address;
   if(!address)throw new Error('CHAIN_ADDRESS: Missing deployed contract address');
   const result:ChainReceipt={hash:receipt.transactionHash,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,timestamp:Number(block.timestamp),status:'success',chainId:143,address};
   journal.receipt=result;await atomicJSON(path,journal);return result;
  }finally{release();}
 };
 return {client,account,send};
}
export async function casebookChain(root:string,address:Address):Promise<CaseChain>{
 const writer=await transactionWriter(root,{address});
 const owner=await writer.client.readContract({address,abi:casebookAbi,functionName:'owner'});
 if(owner.toLowerCase()!==writer.account.address.toLowerCase())throw new Error('CHAIN_OWNER: Server wallet does not own CaseBook');
 return {
  address,
  async inspect(id){const hashId=chainCaseId(id);const [[hash,closed],[opensAt,closesAt]]=await Promise.all([
   writer.client.readContract({address,abi:casebookAbi,functionName:'caseOf',args:[hashId]}),
   writer.client.readContract({address,abi:casebookAbi,functionName:'caseTimes',args:[hashId]}),
  ]);return {hash,closed,opensAt:Number(opensAt),closesAt:Number(closesAt)};},
  open(draft,opensAt,closesAt){return writer.send(`${draft.public.id}-open`,encodeFunctionData({abi:casebookAbi,functionName:'openCase',args:[chainCaseId(draft.public.id),draft.public.answerHash as Hex,BigInt(opensAt),BigInt(closesAt)]}),address,address);},
  close(draft){return writer.send(`${draft.public.id}-close`,encodeFunctionData({abi:casebookAbi,functionName:'closeCase',args:[chainCaseId(draft.public.id),encodedKey(draft)]}),address,address);},
  cast(draft:CaseDraft){return writer.send(`${draft.public.id}-cast`,encodeFunctionData({abi:casebookAbi,functionName:'recordCast',args:[chainCaseId(draft.public.id),draft.public.cast.map(item=>BigInt(item.tokenId)),draft.public.cast.map(item=>1+(item.tokenId===draft.public.subject.tokenId?2:0)+(item.tokenId===draft.private.key.lie.witness?4:0))]}),address,address);},
 };
}
