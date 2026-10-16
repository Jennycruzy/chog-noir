import {readFile} from 'node:fs/promises';
import {loadEscrow} from './load-escrow.mts';
import {EscrowIndex,type EscrowInput} from '../packages/core/src/escrow.mts';
import {type StoredTrace} from '../packages/core/src/native-payments.mts';
import {CHOG,TRANSFER_TOPIC,decodeTransfer,type ChainLog,ZERO} from '../packages/core/src/chain.mts';
export async function escrowContext(toBlockExclusive:number,logs:readonly ChainLog[]) {
  const input=await loadEscrow(toBlockExclusive);
  const transfers=logs.filter(log=>log.address.toLowerCase()===CHOG&&log.topics[0]===TRANSFER_TOPIC).map(decodeTransfer);
  const partial=new EscrowIndex(input,transfers);
  const traces:Record<string,StoredTrace>={};
  for(const deal of partial.deals) {
    if(!deal.sold||deal.paymentToken!==ZERO||traces[deal.sold.tx])continue;
    traces[deal.sold.tx]=JSON.parse(await readFile(new URL(`../data/escrow-traces/${deal.sold.tx}.json`,import.meta.url),'utf8')) as StoredTrace;
  }
  return {input,traces,index:new EscrowIndex(input,transfers,{traces,logs})};
}
