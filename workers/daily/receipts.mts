import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {PublicClient} from 'viem';
import type {Source} from '../../packages/core/src/enrich.mts';
import type {PuzzleCase} from '../../packages/cases/src/puzzle.mts';
import type {StoredHistory} from '../../scripts/data-types.mts';
import {atomicJSON} from '../../packages/publishing/src/vault.mts';

export const puzzleSources=(puzzle:PuzzleCase):Source[]=>[...puzzle.file.receipts.flatMap(row=>row.sources),...puzzle.file.tiles.flatMap(row=>row.sources),puzzle.file.cutoff];

/** Every cited log must match a successful, canonical RPC receipt for the same block, log index, address, topics and data. */
export async function verifySourceReceipts(rpc:Pick<PublicClient,'getTransactionReceipt'|'getBlock'>,data:StoredHistory['data'],sources:readonly Source[],directory:string){
 await mkdir(directory,{recursive:true,mode:0o700});
 for(const tx of new Set(sources.map(source=>source.tx.toLowerCase()))){
  const receipt=await rpc.getTransactionReceipt({hash:tx as `0x${string}`});if(receipt.status!=='success')throw new Error('DAILY_RECEIPT: Selected source transaction failed');
  const canonical=await rpc.getBlock({blockNumber:receipt.blockNumber});if(canonical.hash!==receipt.blockHash)throw new Error('DAILY_REORG: Selected receipt is no longer canonical');
  for(const source of sources.filter(source=>source.tx.toLowerCase()===tx)){
   const original=data.logs.find(log=>log.transactionHash.toLowerCase()===tx&&log.logIndex===source.logIndex),actual=receipt.logs.find(log=>log.logIndex===source.logIndex);
   if(Number(receipt.blockNumber)!==source.block||!original||!actual||actual.address.toLowerCase()!==original.address.toLowerCase()||actual.data!==original.data||JSON.stringify(actual.topics)!==JSON.stringify(original.topics.filter(topic=>topic!==null)))throw new Error('DAILY_RECEIPT: Source log does not match receipt');
  }
  await atomicJSON(join(directory,tx+'.json'),JSON.parse(JSON.stringify(receipt,(_,value)=>typeof value==='bigint'?value.toString():value)));
 }
}
