import { decodeAbiParameters, parseAbiParameters, keccak256, type Hex } from 'viem';
import { TRANSFER_TOPIC, ZERO } from '../../core/src/chain.mts';
export interface RecordInput {
 log:{address:string;topics:(string|null)[];data:string;transactionHash:string;blockNumber:number;logIndex:number};
 tx:{hash:string;from:string;to:string;input:string;status:number};
}
export interface CodeProof {address:string;historicalCode:string|null;currentCode:string;fetchedAt:string;exampleTx:string}
const lower=(value:string)=>value.toLowerCase();
// Conservative analysis: any state access, external execution, creation or
// destruction excludes a contract from this narrow event-emitter detector.
export function statelessEmitter(code:string) {
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(code))return false;
 const bytes=Buffer.from(code.slice(2),'hex');
 // Do not trim compiler metadata: excluding a contract because metadata bytes
 // resemble an opcode is safer than accidentally removing executable bytes.
 const forbidden=new Set([0x54,0x55,0x5c,0x5d,0xf0,0xf1,0xf2,0xf4,0xf5,0xfa,0xff]);
 let logs=0;
 for(let index=0;index<bytes.length;index++){
  const op=bytes[index]!;
  if(forbidden.has(op))return false;
  if(op===0xa3)logs++;
  if(op>=0x60&&op<=0x7f){if(index+(op-0x5f)>=bytes.length)return false;index+=op-0x5f;}
 }
 return logs>0;
}
export function assessRecord(input:RecordInput,targetWallet:string,proof?:CodeProof){
 if(!/^0x[0-9a-f]{40}$/i.test(targetWallet))throw new Error('DETECTOR_TARGET: A valid queried wallet is required');
 const {log,tx}=input;
 const topics=[...log.topics];while(topics.length&&topics.at(-1)==null)topics.pop();
 if(topics.length!==3||lower(topics[0]??'')!==TRANSFER_TOPIC||!topics.slice(1).every(topic=>typeof topic==='string'&&/^0x0{24}[0-9a-f]{40}$/i.test(topic))||!/^0x[0-9a-f]{64}$/i.test(log.data))return {status:'NOT_ERC20_TRANSFER' as const};
 const sender=`0x${topics[1]!.slice(-40)}`.toLowerCase(),receiver=`0x${topics[2]!.slice(-40)}`.toLowerCase();
 if(sender!==lower(targetWallet))return {status:'NO_MATCH' as const};
 if(!/^0x[0-9a-f]{40}$/i.test(log.address)||!/^0x[0-9a-f]{64}$/i.test(log.transactionHash)||lower(tx.hash)!==lower(log.transactionHash)||!Number.isSafeInteger(log.blockNumber)||!Number.isSafeInteger(log.logIndex))throw new Error('DETECTOR_SOURCE: Invalid record identity');
 if(sender===ZERO||lower(tx.from)===sender||lower(tx.to)!==lower(log.address)||tx.status!==1||BigInt(log.data)===0n)return {status:'NO_MATCH' as const};
 if(!proof||lower(proof.address)!==lower(log.address)||lower(proof.exampleTx)!==lower(tx.hash)||!Number.isFinite(Date.parse(proof.fetchedAt))||!proof.historicalCode||lower(proof.historicalCode)!==lower(proof.currentCode)||!statelessEmitter(proof.historicalCode))return {status:'REVIEW' as const,reason:'Signer mismatch is insufficient; stateful, delegated or unproven execution'};
 if(lower(tx.input.slice(0,10))!=='0x7111a994')return {status:'REVIEW' as const,reason:'Unknown call encoding'};
 let bound=false;
 try{
  const [from,to,amounts]=decodeAbiParameters(parseAbiParameters('address[], address[], uint256[]'),`0x${tx.input.slice(10)}` as Hex);
  if(from.length!==to.length||from.length!==amounts.length)throw new Error('Invalid batch lengths');
  bound=from.some((address,index)=>lower(address)===sender&&lower(to[index]!)===receiver&&amounts[index]===BigInt(log.data));
 }catch{return {status:'REVIEW' as const,reason:'Batch calldata cannot be validated'};}
 if(!bound)return {status:'REVIEW' as const,reason:'Log not bound to caller-supplied batch values'};
 return {status:'SYNTHETIC_RECORD' as const,sender,receiver,amount:BigInt(log.data).toString(),
  proof:{tx:lower(tx.hash),block:log.blockNumber,logIndex:log.logIndex,token:lower(log.address),codeHash:keccak256(proof.historicalCode as Hex),exampleTx:proof.exampleTx,
   reasons:['Different transaction signer','Direct call to the emitting contract','Caller supplied the exact from/to/amount values','Matching observed historical/current code has no state operations or external execution']},
  note:'The emitting contract wrote this record without a token-balance update. No claim about a real person or off-chain intent.'};
}
export function foldSymbol(symbol:string){return symbol.normalize('NFKD').replace(/\p{M}/gu,'').toUpperCase();}
export function assessSymbol(address:string,symbol:string,assets:Record<string,string[]>){
 if(!/^0x[0-9a-f]{40}$/i.test(address)||symbol.length>128)throw new Error('DETECTOR_SYMBOL: Invalid symbol source');
 const normalized=foldSymbol(symbol),reference=assets[normalized];
 if(!reference)return {status:'UNLISTED_SYMBOL' as const};
 if(reference.some(value=>lower(value)===lower(address)))return {status:'REFERENCE_ADDRESS' as const};
 // An ordinary shared ticker is not evidence of a homoglyph attack.
 if(symbol.toUpperCase()===normalized)return {status:'SHARED_SYMBOL_REVIEW' as const};
 return {status:'LOOKALIKE' as const,shown:symbol,normalized,address:lower(address),referenceAddresses:reference,
  note:'Unicode symbol resembles a referenced symbol at a different address. This is a symbol comparison, not proof of signer authorization or a claim about a person.'};
}
