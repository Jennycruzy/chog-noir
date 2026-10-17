import {keccak256,type Hex} from 'viem';
import type {RecordInput} from './records.mts';
export interface RpcEvidence {provider?:string;fetchedAt:string;request:{method:string;params:unknown[]};reply:{result?:unknown;error?:unknown}}
export function verifyFindingSources(input:RecordInput,codeHash:string,execution:RpcEvidence,receiptSource:RpcEvidence):string[]{
 try{
  const errors:string[]=[];const tx=input.tx.hash.toLowerCase();
  if(!Number.isFinite(Date.parse(execution.fetchedAt))||!Number.isFinite(Date.parse(receiptSource.fetchedAt))||execution.reply.error||receiptSource.reply.error)errors.push('SOURCE_UNAVAILABLE');
  const options=execution.request.params[1] as {tracer?:string}|undefined;
  if(execution.request.method!=='debug_traceTransaction'||execution.request.params[0]!==tx||options?.tracer!=='prestateTracer')errors.push('EXECUTION_REQUEST');
  if(receiptSource.request.method!=='eth_getTransactionReceipt'||receiptSource.request.params[0]!==tx)errors.push('RECEIPT_REQUEST');
  const accounts=execution.reply.result as Record<string,{code?:string}>|undefined;
  const matches=accounts?Object.entries(accounts).filter(([address])=>address.toLowerCase()===input.log.address.toLowerCase()):[];
  const code=matches.length===1?matches[0]![1].code:undefined;
  if(!code||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||keccak256(code as Hex)!==codeHash)errors.push('EXECUTION_CODE');
  const receipt=receiptSource.reply.result as {status?:string;transactionHash?:string;blockNumber?:string;logs?:{address:string;transactionHash:string;logIndex:string;topics:string[];data:string;removed?:boolean}[]}|undefined;
  if(!receipt||receipt.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==tx||!receipt.blockNumber||Number(BigInt(receipt.blockNumber))!==input.log.blockNumber)errors.push('RECEIPT_IDENTITY');
  if(!Array.isArray(receipt?.logs))return [...errors,'RECEIPT_LOGS'];
  const logs=receipt.logs.filter(log=>Number(BigInt(log.logIndex))===input.log.logIndex);
  if(logs.length!==1)errors.push('LOG_IDENTITY');
  else{
   const log=logs[0]!,topics=input.log.topics.filter(topic=>topic!==null).map(topic=>topic.toLowerCase());
   if(log.removed||log.address.toLowerCase()!==input.log.address.toLowerCase()||log.transactionHash.toLowerCase()!==tx||log.data.toLowerCase()!==input.log.data.toLowerCase()||JSON.stringify(log.topics.map(topic=>topic.toLowerCase()))!==JSON.stringify(topics))errors.push('LOG_CONTENT');
  }
  return errors;
 }catch{return ['INVALID_SOURCE'];}
}
