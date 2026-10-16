import {nativePayments,type StoredTrace,type NativePayment,type CallFrame} from './native-payments.mts';
import {decodeEventLog,decodeFunctionData,parseAbi,type Hex} from 'viem';
import {CHOG,CHOG_TOKEN,ESCROW,WMON,ZERO,type ChainLog,type Transfer} from './chain.mts';
const callbackAbi=parseAbi(['function onERC721Received(address operator,address from,uint256 tokenId,bytes data) returns (bytes4)']);
function callbackPaths(root:CallFrame,deal:EscrowDeal):number[][] {
  const found:number[][]=[];
  function visit(frame:CallFrame,path:number[]) {
    if(frame.error)return;
    if(frame.type.toUpperCase()==='CALL'&&frame.from.toLowerCase()===CHOG&&frame.to?.toLowerCase()===ESCROW&&frame.input?.slice(0,10).toLowerCase()==='0x150b7a02') {
      const decoded=decodeFunctionData({abi:callbackAbi,data:frame.input as Hex});
      const [,seller,tokenId,data]=decoded.args;
      if(/^0x[0-9a-f]{64}$/i.test(data)&&BigInt(data).toString()===deal.id&&tokenId===BigInt(deal.tokenId)&&seller.toLowerCase()===deal.sold?.seller)found.push(path);
    }
    for(const [index,child]of(frame.calls??[]).entries())visit(child,[...path,index]);
  }
  visit(root,[]);return found;
}
export const escrowAbi=parseAbi([
  'event DealCreated(uint256 indexed id,address indexed buyer,address indexed collection,uint256 tokenId,address payment,uint256 amount,uint64 deadline,string note)',
  'event DealSold(uint256 indexed id,address indexed seller)',
  'event DealCollected(uint256 indexed id,address indexed buyer)',
  'event DealCancelled(uint256 indexed id,address indexed buyer)',
]);
export interface ApiSource {fetchedAt:string;request:unknown}
export interface EscrowInput {fromBlock:0;toBlockExclusive:number;logs:ChainLog[];sources:Record<string,ApiSource>}
export interface EscrowSource {tx:string;block:number;logIndex:number;log:ChainLog;api:ApiSource}
export interface EscrowDeal {
  id:string;collection:string;tokenId:number;buyer:string;paymentToken:string;amountWei:string;deadline:string;
  created:EscrowSource;sold:(EscrowSource&{seller:string})|null;collected:EscrowSource|null;cancelled:EscrowSource|null;
}
export interface EscrowProof {
  dealId:string;role:'deposit'|'collection';buyer:string;seller:string;paymentToken:string;amountWei:string;
  paymentAtThisTransfer:boolean;paymentProof:{kind:'native';transfer:NativePayment;source:StoredTrace}|{kind:'ERC20';log:ChainLog};created:EscrowSource;paid:EscrowSource;collected:EscrowSource|null;
}
const key=(source:{tx:string;logIndex:number})=>`${source.tx}:${source.logIndex}`;
const precedes=(first:{block:number;logIndex:number},second:{block:number;logIndex:number})=>first.block<second.block||(first.block===second.block&&first.logIndex<second.logIndex);
export class EscrowIndex {
  private readonly proofs=new Map<string,{transfer:Transfer;proof:EscrowProof}>();
  readonly deals:EscrowDeal[];
  constructor(input:EscrowInput,transfers:readonly Transfer[],payments:{traces?:Record<string,StoredTrace>;logs?:readonly ChainLog[]}={}) {
    if(input.fromBlock!==0||!Number.isSafeInteger(input.toBlockExclusive)||input.toBlockExclusive<=0) throw new Error('DATA_ESCROW_COVERAGE: Complete escrow history from block zero is required');
    const records=new Map<string,EscrowDeal>();
    const seen=new Set<string>();
    const pending:{transfer:Transfer;deal:EscrowDeal;role:EscrowProof['role']}[]=[];
    for(const log of [...input.logs].sort((a,b)=>a.blockNumber-b.blockNumber||a.logIndex-b.logIndex)) {
      if(log.address.toLowerCase()!==ESCROW||log.removed||!/^0x[0-9a-f]{64}$/i.test(log.transactionHash)||!Number.isSafeInteger(log.blockNumber)||log.blockNumber<0||log.blockNumber>=input.toBlockExclusive||!Number.isSafeInteger(log.logIndex)||log.logIndex<0) throw new Error('DATA_ESCROW_LOG: Invalid escrow log');
      const srcKey=`${log.transactionHash.toLowerCase()}:${log.logIndex}`;
      if(seen.has(srcKey)) throw new Error('DATA_ESCROW_DUPLICATE: Repeated escrow log');
      seen.add(srcKey);
      const api=input.sources[srcKey];
      if(!api||!Number.isFinite(Date.parse(api.fetchedAt))||!api.request||typeof api.request!=='object') throw new Error('DATA_ESCROW_SOURCE: Original request and fetch time missing');
      const source:EscrowSource={tx:log.transactionHash.toLowerCase(),block:log.blockNumber,logIndex:log.logIndex,log,api};
      const event=decodeEventLog({abi:escrowAbi,topics:log.topics as [Hex,...Hex[]],data:log.data as Hex,strict:true});
      const id=event.args.id.toString();
      if(event.eventName==='DealCreated') {
        if(records.has(id)||event.args.amount<=0n||event.args.tokenId>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('DATA_ESCROW_CREATE: Duplicate or invalid deal');
        const deal:EscrowDeal={id,collection:event.args.collection.toLowerCase(),tokenId:Number(event.args.tokenId),buyer:event.args.buyer.toLowerCase(),paymentToken:event.args.payment.toLowerCase(),amountWei:event.args.amount.toString(),deadline:event.args.deadline.toString(),created:source,sold:null,collected:null,cancelled:null};
        if(deal.collection===CHOG&&(deal.tokenId<1||deal.tokenId>1969)) throw new Error('DATA_ESCROW_TOKEN: Unexpected Chog token');
        records.set(id,deal);continue;
      }
      const deal=records.get(id);
      if(!deal||!precedes(deal.created,source)) throw new Error('DATA_ESCROW_GAP: Creation record missing or out of order');
      if(event.eventName==='DealCancelled') {
        if(deal.sold||deal.collected||deal.cancelled||event.args.buyer.toLowerCase()!==deal.buyer) throw new Error('DATA_ESCROW_STATE: Invalid cancellation');
        deal.cancelled=source;continue;
      }
      if(event.eventName==='DealSold') {
        if(deal.sold||deal.cancelled||deal.collected) throw new Error('DATA_ESCROW_STATE: Deal cannot be sold again');
        deal.sold={...source,seller:event.args.seller.toLowerCase()};
      } else {
        if(!deal.sold||deal.collected||deal.cancelled||event.args.buyer.toLowerCase()!==deal.buyer||!precedes(deal.sold,source)) throw new Error('DATA_ESCROW_STATE: Invalid collection');
        deal.collected=source;
      }
      if(deal.collection!==CHOG) continue;
      const role=event.eventName==='DealSold'?'deposit':'collection';
      const matches=transfers.filter(transfer=>transfer.tx===source.tx&&transfer.block===source.block&&transfer.tokenId===deal.tokenId&&transfer.logIndex<source.logIndex&&transfer.from===(role==='deposit'?deal.sold!.seller:ESCROW)&&transfer.to===(role==='deposit'?ESCROW:deal.buyer));
      if(matches.length!==1) throw new Error('DATA_ESCROW_TRANSFER: Exact matching NFT transfer missing or ambiguous');
      pending.push({transfer:matches[0]!,deal,role});
    }
    const verified=new Map<string,EscrowProof['paymentProof']>();
    const reserved=new Set<string>();
    for(const deal of records.values()) {
      if(deal.collection!==CHOG||!deal.sold)continue;
      if(deal.paymentToken===ZERO) {
        const trace=payments.traces?.[deal.sold.tx];
        if(!trace)continue;
        const native=nativePayments(deal.sold.tx,trace);
        const callbacks=callbackPaths(trace.reply.result!,deal);
        if(callbacks.length!==1)throw new Error('DATA_ESCROW_PAYMENT: Matching NFT receiver callback missing or ambiguous');
        const callback=callbacks[0]!;
        const matches=native.filter(payment=>payment.from===ESCROW&&payment.to===deal.sold!.seller&&payment.amountWei===deal.amountWei&&payment.path.length===callback.length+1&&callback.every((part,index)=>payment.path[index]===part));
        if(matches.length!==1)throw new Error('DATA_ESCROW_PAYMENT: Exact native seller payment missing or ambiguous');
        const payment=matches[0]!;const id=`${payment.tx}:${payment.path.join('.')}`;
        if(reserved.has(id))throw new Error('DATA_ESCROW_PAYMENT: Native payment reused for another deal');
        reserved.add(id);verified.set(deal.id,{kind:'native',transfer:payment,source:trace});
      } else if((deal.paymentToken===WMON||deal.paymentToken===CHOG_TOKEN)) {
        if(!payments.logs)continue;
        const matches=(payments.logs??[]).filter(log=>log.address.toLowerCase()===deal.paymentToken&&log.transactionHash.toLowerCase()===deal.sold!.tx&&log.blockNumber===deal.sold!.block&&log.topics.length>=3&&log.topics.slice(3).every(topic=>topic==null)&&log.topics[0]?.toLowerCase()==='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'&&log.topics[1]?.toLowerCase()==='0x'+'0'.repeat(24)+ESCROW.slice(2)&&log.topics[2]?.toLowerCase()==='0x'+'0'.repeat(24)+deal.sold!.seller.slice(2)&&/^0x[0-9a-f]{64}$/i.test(log.data)&&BigInt(log.data).toString()===deal.amountWei&&!log.removed);
        if(matches.length!==1)throw new Error('DATA_ESCROW_PAYMENT: Exact token seller payment missing or ambiguous');
        const payment=matches[0]!;const id=`${payment.transactionHash}:${payment.logIndex}`;
        if(reserved.has(id))throw new Error('DATA_ESCROW_PAYMENT: Token payment reused for another deal');
        reserved.add(id);verified.set(deal.id,{kind:'ERC20',log:payment});
      }
    }
    for(const {transfer,deal,role} of pending) {
      if(deal.paymentToken!==ZERO&&deal.paymentToken!==WMON&&deal.paymentToken!==CHOG_TOKEN) continue;
      const transferKey=key(transfer);
      if(this.proofs.has(transferKey)) throw new Error('DATA_ESCROW_TRANSFER: One transfer matches multiple deals');
      if(!deal.sold) throw new Error('DATA_ESCROW_GAP: Payment record missing');
      const paymentProof=verified.get(deal.id);if(!paymentProof)continue;
      this.proofs.set(transferKey,{transfer,proof:{paymentProof,dealId:deal.id,role,buyer:deal.buyer,seller:deal.sold.seller,paymentToken:deal.paymentToken,amountWei:deal.amountWei,paymentAtThisTransfer:role==='deposit',created:deal.created,paid:deal.sold,collected:role==='collection'?deal.collected:null}});
    }
    this.deals=[...records.values()].filter(deal=>deal.collection===CHOG);
  }
  resolve(transfer:Transfer):EscrowProof|undefined {
    const match=this.proofs.get(key(transfer));if(!match)return;
    if(match.transfer.block!==transfer.block||match.transfer.tokenId!==transfer.tokenId||match.transfer.from!==transfer.from||match.transfer.to!==transfer.to)throw new Error('DATA_ESCROW_TRANSFER: Proof does not match the transfer');
    return match.proof;
  }
}
