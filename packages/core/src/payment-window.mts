import {WMON,type Transfer} from './chain.mts';
import {nativePayments,type StoredTrace} from './native-payments.mts';
export interface BlockSource {block:{number:number;timestamp:number;hash:string};api:{fetchedAt:string;request:unknown}}
export type PaymentStream='normal'|'internal'|'WMON';
export interface PaymentPage {
  fetchedAt:string;
  request:{chainid:'143';module:'account';action:'txlist'|'txlistinternal'|'tokentx';address:string;startblock:number;endblock:number;page:number;offset:number;sort:'asc';contractaddress?:string};
  reply:{status:string;message:string;result:unknown};
}
export interface PaymentVerification {block:BlockSource;receipt:{fetchedAt:string;request:{method:string;params:unknown[]};reply:{result?:{transactionHash:string;blockHash:string;blockNumber:string;status:string;logs:{address:string;topics:string[];data:string}[]};error?:unknown}};trace?:StoredTrace}
export interface PaymentWindowInput {transfer:Transfer;center:BlockSource;bounds?:{before:BlockSource;after:BlockSource};pages:PaymentPage[];verifications?:Record<string,PaymentVerification>;traces?:{tx:string;block:BlockSource;trace:StoredTrace}[]}
export interface WindowPayment {tx:string;block:number;time:number;asset:'MON'|'WMON';amountUnits:string;source:PaymentPage|{tx:string;block:BlockSource;trace:StoredTrace}}
function blockSource(source:BlockSource) {
  if(!source?.block||!source?.api||!Number.isSafeInteger(source.block.number)||source.block.number<0||!Number.isSafeInteger(source.block.timestamp)||source.block.timestamp<0||!/^0x[0-9a-f]{64}$/i.test(source.block.hash)||!Number.isFinite(Date.parse(source.api.fetchedAt))||!source.api.request)throw new Error('DATA_PAYMENT_BLOCK: Source block is missing or invalid');
}
const address=(value:unknown):value is string=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value);
export function assessPaymentWindow(input:PaymentWindowInput) {
  blockSource(input.center);
  if(input.center.block.number!==input.transfer.block||!address(input.transfer.from)||!address(input.transfer.to))throw new Error('DATA_PAYMENT_SOURCE: Transfer does not match center block');
  const sender=input.transfer.from.toLowerCase();const receiverAddress=input.transfer.to.toLowerCase();
  const start=input.center.block.timestamp-3600;
  const end=input.center.block.timestamp+3600;
  const payments:WindowPayment[]=[];
  for(const item of input.traces??[]) {
    blockSource(item.block);
    const tx=item.tx;if(typeof tx!=='string')throw new Error('DATA_TRACE_SOURCE: Transaction hash missing');
    for(const payment of nativePayments(tx,item.trace))if(item.block.block.timestamp>=start&&item.block.block.timestamp<=end&&payment.from===receiverAddress&&payment.to===sender)payments.push({tx,block:item.block.block.number,time:item.block.block.timestamp,asset:'MON',amountUnits:payment.amountWei,source:item});
  }
  const groups:Record<PaymentStream,PaymentPage[]>={normal:[],internal:[],WMON:[]};
  for(const page of input.pages) {
    const request=page.request;
    if(request.chainid!=='143'||request.module!=='account'||request.address.toLowerCase()!==receiverAddress||request.sort!=='asc'||!Number.isSafeInteger(request.page)||request.page<1||!Number.isSafeInteger(request.offset)||request.offset<1||request.offset>1000||!Number.isSafeInteger(request.startblock)||!Number.isSafeInteger(request.endblock)||request.startblock<0||request.endblock<request.startblock||!Number.isFinite(Date.parse(page.fetchedAt)))throw new Error('DATA_PAYMENT_QUERY: Invalid or mismatched account query');
    let stream:PaymentStream;
    if(request.action==='txlist')stream='normal';
    else if(request.action==='txlistinternal')stream='internal';
    else if(request.action==='tokentx'&&request.contractaddress?.toLowerCase()===WMON)stream='WMON';
    else throw new Error('DATA_PAYMENT_QUERY: Unsupported payment stream');
    const rows=page.reply.result;
    const empty=page.reply.status==='0'&&page.reply.message==='No transactions found'&&Array.isArray(rows)&&rows.length===0;
    if(!Array.isArray(rows)||(!empty&&page.reply.status!=='1')||rows.length>request.offset)throw new Error('DATA_PAYMENT_REPLY: Error or incomplete API response');
    groups[stream].push(page);
    for(const raw of rows) {
      if(!raw||typeof raw!=='object')throw new Error('DATA_PAYMENT_ROW: Malformed account record');
      const row=raw as Record<string,unknown>;
      const receiver=typeof row.to==='string'&&row.to!==''?row.to:row.contractAddress;
      if(!address(row.from)||!address(receiver)||typeof row.hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(row.hash)||typeof row.value!=='string'||!/^\d+$/.test(row.value)||typeof row.blockNumber!=='string'||!/^\d+$/.test(row.blockNumber)||typeof row.timeStamp!=='string'||!/^\d+$/.test(row.timeStamp))throw new Error('DATA_PAYMENT_ROW: Required amount or source field missing');
      const block=Number(row.blockNumber);const time=Number(row.timeStamp);
      if(!Number.isSafeInteger(block)||!Number.isSafeInteger(time)||block<request.startblock||block>request.endblock||(row.from.toLowerCase()!==receiverAddress&&receiver.toLowerCase()!==receiverAddress))throw new Error('DATA_PAYMENT_RANGE: Record falls outside account query');
      if(stream==='WMON'&&(typeof row.contractAddress!=='string'||row.contractAddress.toLowerCase()!==WMON))throw new Error('DATA_PAYMENT_TOKEN: Record is not from official WMON');
      if(stream!=='WMON'&&row.isError!=='0'&&row.isError!=='1')throw new Error('DATA_PAYMENT_STATUS: Transaction result missing');
      if(stream!=='WMON'&&row.isError==='1')continue;
      if(row.from.toLowerCase()===receiverAddress&&receiver.toLowerCase()===sender&&time>=start&&time<=end&&BigInt(row.value)>0n)payments.push({tx:row.hash.toLowerCase(),block,time,asset:stream==='WMON'?'WMON':'MON',amountUnits:row.value,source:page});
    }
  }
  if(payments.length) {
    let verified=true;
    for(const payment of payments) {
      if(!('request' in payment.source))continue; // Direct execution evidence has already been decoded above.
      const proof=input.verifications?.[payment.tx];
      if(!proof){verified=false;continue;}
      blockSource(proof.block);
      const receipt=proof.receipt.reply.result;
      if(!receipt||proof.receipt.reply.error||proof.receipt.request.method!=='eth_getTransactionReceipt'||proof.receipt.request.params[0]!==payment.tx||!Number.isFinite(Date.parse(proof.receipt.fetchedAt))||receipt.transactionHash.toLowerCase()!==payment.tx||receipt.status!=='0x1'||!/^0x[0-9a-f]+$/i.test(receipt.blockNumber)||Number(BigInt(receipt.blockNumber))!==payment.block||receipt.blockHash.toLowerCase()!==proof.block.block.hash.toLowerCase()||proof.block.block.number!==payment.block||proof.block.block.timestamp!==payment.time)throw new Error('DATA_PAYMENT_VERIFY: Payment does not match its successful transaction and source block');
      if(payment.asset==='MON') {
        if(!proof.trace){verified=false;continue;}
        const found=nativePayments(payment.tx,proof.trace).some(record=>record.from===receiverAddress&&record.to===sender&&record.amountWei===payment.amountUnits);
        if(!found)throw new Error('DATA_PAYMENT_VERIFY: Native payment is absent from successful execution calls');
      } else {
        const found=receipt.logs.some(log=>log.address.toLowerCase()===WMON&&log.topics.length===3&&log.topics[0]?.toLowerCase()==='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'&&log.topics[1]?.toLowerCase()==='0x'+'0'.repeat(24)+receiverAddress.slice(2)&&log.topics[2]?.toLowerCase()==='0x'+'0'.repeat(24)+sender.slice(2)&&/^0x[0-9a-f]{64}$/i.test(log.data)&&BigInt(log.data).toString()===payment.amountUnits);
        if(!found)throw new Error('DATA_PAYMENT_VERIFY: WMON payment is absent from the official token logs');
      }
    }
    return {status:verified?'PAYMENT_FOUND' as const:'PAYMENT_OBSERVED' as const,start,end,payments,reason:verified?'Payment from the receiving wallet to the sending wallet was corroborated by chain execution':'Account history reports a payment; matching chain execution is still required'};
  }
  if(!input.bounds)return {status:'INCOMPLETE' as const,start,end,payments,reason:'Full payment-window boundaries are missing'};
  const {before,after}=input.bounds;blockSource(before);blockSource(after);
  if(before.block.timestamp>=start||after.block.timestamp<=end||before.block.number>=input.center.block.number||after.block.number<=input.center.block.number)throw new Error('DATA_PAYMENT_BOUNDARY: Source blocks do not enclose the two-hour window');
  for(const stream of ['normal','internal','WMON'] as const) {
    const pages=[...groups[stream]].sort((a,b)=>a.request.page-b.request.page);
    if(!pages.length)return {status:'INCOMPLETE' as const,start,end,payments,reason:`Missing ${stream} payment history`};
    const offset=pages[0]!.request.offset;
    const fingerprints=new Set<string>();
    for(const [index,page]of pages.entries()) {
      if(page.request.page!==index+1||page.request.offset!==offset||page.request.startblock!==before.block.number+1||page.request.endblock!==after.block.number-1||Date.parse(page.fetchedAt)<(after.block.timestamp+120)*1000)throw new Error('DATA_PAYMENT_COVERAGE: Missing page, mismatched bounds or unconfirmed history');
      const rows=page.reply.result as unknown[];
      const fingerprint=JSON.stringify(rows);
      if(rows.length&&fingerprints.has(fingerprint))throw new Error('DATA_PAYMENT_COVERAGE: Repeated history page');
      fingerprints.add(fingerprint);
      if(index<pages.length-1&&rows.length!==offset)throw new Error('DATA_PAYMENT_COVERAGE: Unexpected page after completed history');
    }
    if((pages.at(-1)!.reply.result as unknown[]).length===offset)return {status:'INCOMPLETE' as const,start,end,payments,reason:`${stream} history has another page`};
  }
  return {status:'NO_PAYMENT_FOUND' as const,start,end,payments,reason:'No MON or WMON payment from the receiving wallet to the sending wallet was found within one hour before or after the transfer'};
}
