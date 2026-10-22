import {createPublicClient,http,decodeEventLog,hexToString,keccak256,toBytes,type Hex,type Address} from 'viem';
import {monad} from './client.mts';
import {casebookAbi,chainCaseId} from './casebook.mts';
import {canonicalJSON,validateCase,type CaseDraft} from '../../cases/src/build.mts';
import type {Publication} from '../../publishing/src/publish.mts';
import type {PuzzlePublication} from '../../publishing/src/puzzles.mts';
import {validatePuzzle,puzzleHash,type PuzzleCase,type PuzzleFile} from '../../cases/src/puzzle.mts';
export async function verifyPublication(record:Publication,draft:CaseDraft,url=process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz'){
 if(!record.open||!record.publishedAt)return {status:'NOT_PUBLISHED',message:'This case has no confirmed publication receipt.',openTx:record.open?.hash??null,closeTx:null};
 const client=createPublicClient({chain:monad,transport:http(url,{timeout:30_000,retryCount:1})});
 if(await client.getChainId()!==143)throw new Error('VERIFY_CHAIN: Wrong network');
 const address=record.contract as Address,id=chainCaseId(record.id);
 const open=await client.getTransactionReceipt({hash:record.open.hash});
 if(open.status!=='success')throw new Error('VERIFY_OPEN: Commitment transaction failed');
 const opened=open.logs.filter(log=>log.address.toLowerCase()===address.toLowerCase()).map(log=>{try{return decodeEventLog({abi:casebookAbi,topics:log.topics,data:log.data});}catch{return null;}}).find(event=>event?.eventName==='CaseOpened'&&event.args.caseId===id);
 if(opened?.eventName!=='CaseOpened'||opened.args.answerHash!==draft.public.answerHash||Number(opened.args.opensAt)!==record.opensAt||Number(opened.args.closesAt)!==record.closesAt)throw new Error('VERIFY_OPEN: Commitment event differs from the case');
 const openBlock=await client.getBlock({blockNumber:open.blockNumber});
 if(openBlock.hash!==open.blockHash||Number(openBlock.timestamp)*1000>Date.parse(record.publishedAt))throw new Error('VERIFY_ORDER: Case publication predates its canonical commitment');
 if(!record.close)return {status:'COMMITMENT_VERIFIED',message:'The on-chain commitment matches. The full key stays private until the scheduled case close.',openTx:record.open.hash,closeTx:null};
 const close=await client.getTransactionReceipt({hash:record.close.hash});
 const event=close.logs.filter(log=>log.address.toLowerCase()===address.toLowerCase()).map(log=>{try{return decodeEventLog({abi:casebookAbi,topics:log.topics,data:log.data});}catch{return null;}}).find(item=>item?.eventName==='CaseClosed'&&item.args.caseId===id);
 if(close.status!=='success'||event?.eventName!=='CaseClosed')throw new Error('VERIFY_CLOSE: Successful reveal event missing');
 const revealed=hexToString(event.args.answerKey),parsed=JSON.parse(revealed);
 if(keccak256(toBytes(revealed))!==draft.public.answerHash||canonicalJSON(parsed)!==revealed||parsed.caseId!==record.id||canonicalJSON(parsed.key)!==canonicalJSON(draft.private.key)||parsed.salt!==draft.private.salt||validateCase(draft).length)throw new Error('VERIFY_KEY: Revealed key differs from the committed case');
 const closeBlock=await client.getBlock({blockNumber:close.blockNumber});
 if(closeBlock.hash!==close.blockHash||Number(closeBlock.timestamp)<record.closesAt)throw new Error('VERIFY_CLOSE: Reveal block is not canonical or is too early');
 return {status:'PASS',message:'The commitment preceded publication, the canonical revealed key reproduces its hash, and the case answers match their ledger.',openTx:record.open.hash,closeTx:record.close.hash};
}

/** Independent v2 check: the commitment precedes publication, and after close the key revealed on chain reproduces the hash and binds the public case file. */
export async function verifyPuzzlePublication(record:Pick<PuzzlePublication,'id'|'contract'|'answerHash'|'opensAt'|'closesAt'|'publishedAt'|'open'|'close'>,file:PuzzleFile|null,url=process.env.MONAD_RPC_HTTP??'https://rpc.monad.xyz'){
 if(!record.open||!record.publishedAt)return {status:'NOT_PUBLISHED' as const,message:'This case has no confirmed publication receipt.',openTx:record.open?.hash??null,closeTx:null};
 const client=createPublicClient({chain:monad,transport:http(url,{timeout:30_000,retryCount:1})});
 if(await client.getChainId()!==143)throw new Error('VERIFY_CHAIN: Wrong network');
 const address=record.contract as Address,id=chainCaseId(record.id);
 const events=async(hash:Hex)=>{const receipt=await client.getTransactionReceipt({hash});return {receipt,events:receipt.logs.filter(log=>log.address.toLowerCase()===address.toLowerCase()).map(log=>{try{return decodeEventLog({abi:casebookAbi,topics:log.topics,data:log.data});}catch{return null;}})};};
 const open=await events(record.open.hash);
 const opened=open.events.find(event=>event?.eventName==='CaseOpened'&&event.args.caseId===id);
 if(open.receipt.status!=='success'||opened?.eventName!=='CaseOpened'||opened.args.answerHash!==record.answerHash||Number(opened.args.opensAt)!==record.opensAt||Number(opened.args.closesAt)!==record.closesAt)throw new Error('VERIFY_OPEN: Commitment event differs from the case');
 const openBlock=await client.getBlock({blockNumber:open.receipt.blockNumber});
 if(openBlock.hash!==open.receipt.blockHash||Number(openBlock.timestamp)*1000>Date.parse(record.publishedAt))throw new Error('VERIFY_ORDER: Case publication predates its canonical commitment');
 if(!record.close)return {status:'COMMITMENT_VERIFIED' as const,message:'The on-chain commitment matches and preceded publication. The answer key stays private until the case closes.',openTx:record.open.hash,closeTx:null};
 if(!file)throw new Error('VERIFY_FILE: The public case file is required after close');
 const close=await events(record.close.hash),revealed=close.events.find(event=>event?.eventName==='CaseClosed'&&event.args.caseId===id);
 if(close.receipt.status!=='success'||revealed?.eventName!=='CaseClosed')throw new Error('VERIFY_CLOSE: Successful reveal event missing');
 const text=hexToString(revealed.args.answerKey),key=JSON.parse(text) as PuzzleCase['key'],puzzle:PuzzleCase={file,key,answerHash:record.answerHash};
 if(keccak256(toBytes(text))!==record.answerHash||canonicalJSON(key)!==text||key.caseId!==record.id||file.id!==record.id||puzzleHash(puzzle)!==record.answerHash||validatePuzzle(puzzle).length)throw new Error('VERIFY_KEY: Revealed key does not reproduce the committed case');
 const closeBlock=await client.getBlock({blockNumber:close.receipt.blockNumber});
 if(closeBlock.hash!==close.receipt.blockHash||Number(closeBlock.timestamp)<record.closesAt)throw new Error('VERIFY_CLOSE: Reveal block is not canonical or is too early');
 return {status:'PASS' as const,message:'The answer was locked on chain before the case opened. The key revealed at close reproduces that lock, binds this case file, and its answers match the receipts.',openTx:record.open.hash,closeTx:record.close.hash};
}
