import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {assessPaymentWindow,type PaymentWindowInput,type PaymentPage} from '../src/payment-window.mts';
import {EscrowIndex,type EscrowInput} from '../src/escrow.mts';
import {type StoredTrace} from '../src/native-payments.mts';
import {CHOG,TRANSFER_TOPIC,decodeTransfer,ZERO,type ChainLog} from '../src/chain.mts';
const fixture=JSON.parse(await readFile(new URL('history/escrow.json',import.meta.url),'utf8')) as {windowBlocks:{center:PaymentWindowInput['center'];before:PaymentWindowInput['center'];after:PaymentWindowInput['center']};input:EscrowInput;traces:Record<string,StoredTrace>;logs:ChainLog[]};
const transfers=fixture.logs.filter(log=>log.address.toLowerCase()===CHOG&&log.topics[0]===TRANSFER_TOPIC).map(decodeTransfer);
const index=new EscrowIndex(fixture.input,transfers,{traces:fixture.traces,logs:fixture.logs});
const transfer=transfers.find(transfer=>transfer.block===fixture.windowBlocks.center.block.number&&index.resolve(transfer)?.role==='deposit'&&index.resolve(transfer)?.paymentToken===ZERO)!;
const input:PaymentWindowInput={transfer,center:fixture.windowBlocks.center,bounds:{before:fixture.windowBlocks.before,after:fixture.windowBlocks.after},pages:[]};
test('missing account history cannot prove absence of payment',()=>{expect(assessPaymentWindow(input).status).toBe('INCOMPLETE');});
test('missing boundaries cannot prove absence of payment',()=>{expect(assessPaymentWindow({transfer,center:input.center,pages:[]}).status).toBe('INCOMPLETE');});
test('real escrow execution proves the native seller payment without an absence claim',()=>{
  const trace=fixture.traces[transfer.tx]!;
  const result=assessPaymentWindow({...input,traces:[{tx:transfer.tx,block:input.center,trace}]});
  expect(result.status).toBe('PAYMENT_FOUND');expect(result.payments.some(payment=>payment.tx===transfer.tx&&payment.amountUnits===index.resolve(transfer)?.amountWei)).toBe(true);
});
test('window is exactly one hour on either side of the source block',()=>{const result=assessPaymentWindow(input);expect(result.start).toBe(input.center.block.timestamp-3600);expect(result.end).toBe(input.center.block.timestamp+3600);});
test('wrong center block is rejected',()=>{expect(()=>assessPaymentWindow({...input,center:fixture.windowBlocks.after})).toThrow('DATA_PAYMENT_SOURCE');});
test('damaged source header is rejected',()=>{expect(()=>assessPaymentWindow({...input,center:{...input.center,block:{...input.center.block,hash:'0x'}}})).toThrow('DATA_PAYMENT_BLOCK');});
test('bounds that exclude part of the window are rejected',()=>{expect(()=>assessPaymentWindow({...input,bounds:{before:input.center,after:fixture.windowBlocks.after}})).toThrow('DATA_PAYMENT_BOUNDARY');});
test('execution record for another transaction is rejected',()=>{
  const trace=structuredClone(fixture.traces[transfer.tx]!);trace.request.params[0]=index.resolve(transfer)!.created.tx;
  expect(()=>assessPaymentWindow({...input,traces:[{tx:transfer.tx,block:input.center,trace}]})).toThrow('DATA_TRACE_SOURCE');
});
// Invalid request copies must fail before their responses can support a claim.
const request:PaymentPage['request']={chainid:'143',module:'account',action:'txlistinternal',address:transfer.to,startblock:input.bounds!.before.block.number+1,endblock:input.bounds!.after.block.number-1,page:1,offset:100,sort:'asc'};
const invalidReply={status:'0',message:'NOTOK',result:'Missing account-history source'};
test('API errors cannot become an empty-history result',()=>{expect(()=>assessPaymentWindow({...input,pages:[{request,fetchedAt:fixture.input.sources[`${index.resolve(transfer)!.paid.tx}:${index.resolve(transfer)!.paid.logIndex}`]!.fetchedAt,reply:invalidReply}]})).toThrow('DATA_PAYMENT_REPLY');});
test('another wallet query cannot support this transfer',()=>{expect(()=>assessPaymentWindow({...input,pages:[{request:{...request,address:transfer.from},fetchedAt:input.center.api.fetchedAt,reply:invalidReply}]})).toThrow('DATA_PAYMENT_QUERY');});
test('missing fetch time is rejected',()=>{expect(()=>assessPaymentWindow({...input,pages:[{request,fetchedAt:'',reply:invalidReply}]})).toThrow('DATA_PAYMENT_QUERY');});
const unpaid=JSON.parse(await readFile(new URL('history/payment-unpaid.json',import.meta.url),'utf8')) as {input:PaymentWindowInput};
const paid=JSON.parse(await readFile(new URL('history/payment-paid.json',import.meta.url),'utf8')) as {input:PaymentWindowInput};
test('three complete real account histories support the limited no-payment finding',()=>{
  const result=assessPaymentWindow(unpaid.input);expect(result.status).toBe('NO_PAYMENT_FOUND');expect(result.payments).toEqual([]);
});
test('known paid deposit is also found in real account-history replies',()=>{
  const result=assessPaymentWindow(paid.input);expect(result.status).toBe('PAYMENT_FOUND');
  expect(result.payments.some(payment=>payment.tx==='0xac5436c4a942dceef690a54967db391c6741f3c01a9099592ac27d5c4a55346e'&&payment.asset==='MON'&&payment.amountUnits==='1000000000000000000')).toBe(true);
});
test('removing real internal history prevents a no-payment finding',()=>{
  expect(assessPaymentWindow({...unpaid.input,pages:unpaid.input.pages.filter(page=>page.request.action!=='txlistinternal')}).status).toBe('INCOMPLETE');
});
test('removing real token history prevents a no-payment finding',()=>{
  expect(assessPaymentWindow({...unpaid.input,pages:unpaid.input.pages.filter(page=>page.request.action!=='tokentx')}).status).toBe('INCOMPLETE');
});
test('altered page boundaries cannot claim full coverage',()=>{
  const damaged=structuredClone(unpaid.input);damaged.pages[0]!.request.startblock++;
  expect(()=>assessPaymentWindow(damaged)).toThrow('DATA_PAYMENT_COVERAGE');
});
test('skipping the initial history page is rejected',()=>{
  const damaged=structuredClone(unpaid.input);damaged.pages[0]!.request.page=2;
  expect(()=>assessPaymentWindow(damaged)).toThrow('DATA_PAYMENT_COVERAGE');
});
test('query made before the window closed cannot prove no payment',()=>{
  const damaged=structuredClone(unpaid.input);damaged.pages[0]!.fetchedAt=new Date(damaged.center.block.timestamp*1000).toISOString();
  expect(()=>assessPaymentWindow(damaged)).toThrow('DATA_PAYMENT_COVERAGE');
});
test('another token contract cannot stand in for official WMON history',()=>{
  const damaged=structuredClone(unpaid.input);damaged.pages.find(page=>page.request.action==='tokentx')!.request.contractaddress=CHOG;
  expect(()=>assessPaymentWindow(damaged)).toThrow('DATA_PAYMENT_QUERY');
});
test('reported payments remain pending until chain execution is corroborated',()=>{
  const input=structuredClone(paid.input);delete input.verifications;
  expect(assessPaymentWindow(input).status).toBe('PAYMENT_OBSERVED');
});
test('failed transaction receipt cannot corroborate an API payment',()=>{
  const input=structuredClone(paid.input);const proof=Object.values(input.verifications!)[0]!;proof.receipt.reply.result!.status='0x0';
  expect(()=>assessPaymentWindow(input)).toThrow('DATA_PAYMENT_VERIFY');
});
test('payment attributed to another block is rejected',()=>{
  const input=structuredClone(paid.input);const proof=Object.values(input.verifications!)[0]!;proof.block.block.number++;
  expect(()=>assessPaymentWindow(input)).toThrow('DATA_PAYMENT_VERIFY');
});
test('address letter case cannot hide a real payment',()=>{
  const input=structuredClone(paid.input);input.transfer.from=`0x${input.transfer.from.slice(2).toUpperCase()}`;input.transfer.to=`0x${input.transfer.to.slice(2).toUpperCase()}`;
  expect(assessPaymentWindow(input).status).toBe('PAYMENT_FOUND');
});
