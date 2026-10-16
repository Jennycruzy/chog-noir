import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {EscrowIndex,type EscrowInput} from '../src/escrow.mts';
import {nativePayments,type StoredTrace,type CallFrame} from '../src/native-payments.mts';
import {CHOG,CHOG_TOKEN,ESCROW,ZERO,TRANSFER_TOPIC,decodeTransfer,type ChainLog,type ChainTransaction} from '../src/chain.mts';
import {classifyTransaction} from '../src/classify.mts';
const fixture=JSON.parse(await readFile(new URL('history/escrow.json',import.meta.url),'utf8')) as {input:EscrowInput;traces:Record<string,StoredTrace>;logs:ChainLog[];transactions:ChainTransaction[]};
const transfers=fixture.logs.filter(log=>log.address.toLowerCase()===CHOG&&log.topics[0]===TRANSFER_TOPIC).map(decodeTransfer);
const build=(input=fixture.input,traces=fixture.traces,logs=fixture.logs)=>new EscrowIndex(input,transfers,{traces,logs});
const index=build();
const proofs=transfers.map(transfer=>({transfer,proof:index.resolve(transfer)})).filter(row=>row.proof);
const native=proofs.find(row=>row.proof?.role==='deposit'&&row.proof.paymentToken===ZERO)!;
const token=proofs.find(row=>row.proof?.role==='deposit'&&row.proof.paymentToken===CHOG_TOKEN)!;
function frame(root:CallFrame,path:number[]):CallFrame{return path.reduce((current,index)=>current.calls![index]!,root);}

test('all 90 escrow deposits and 90 collections have matching records',()=>{
  expect(proofs.filter(row=>row.proof?.role==='deposit')).toHaveLength(90);
  expect(proofs.filter(row=>row.proof?.role==='collection')).toHaveLength(90);
});
test('32 deals pay native MON and 58 pay the official CHOG token',()=>{
  expect(index.deals.filter(deal=>deal.sold&&deal.paymentToken===ZERO)).toHaveLength(32);
  expect(index.deals.filter(deal=>deal.sold&&deal.paymentToken===CHOG_TOKEN)).toHaveLength(58);
});
test('native seller payment is corroborated by its receiver callback',()=>{
  expect(native.proof?.paymentProof.kind).toBe('native');
  if(native.proof?.paymentProof.kind!=='native')throw new Error('Native proof missing');
  expect(native.proof.paymentProof.transfer.from).toBe(ESCROW);
  expect(native.proof.paymentProof.transfer.to).toBe(native.transfer.from);
  expect(native.proof.paymentProof.transfer.amountWei).toBe(native.proof.amountWei);
});
test('token seller payment uses a real log from the official CHOG contract',()=>{
  expect(token.proof?.paymentProof.kind).toBe('ERC20');
  if(token.proof?.paymentProof.kind!=='ERC20')throw new Error('Token proof missing');
  expect(token.proof.paymentProof.log.address).toBe(CHOG_TOKEN);
  expect(BigInt(token.proof.paymentProof.log.data).toString()).toBe(token.proof.amountWei);
});
test('collection references the earlier payment without creating another sale',()=>{
  const row=proofs.find(row=>row.proof?.role==='collection')!;
  expect(row.proof?.paymentAtThisTransfer).toBe(false);
  expect(row.proof?.paid.tx).not.toBe(row.transfer.tx);
  const tx=fixture.transactions.find(tx=>tx.hash===row.transfer.tx)!;
  const event=classifyTransaction(tx,fixture.logs.filter(log=>log.transactionHash===tx.hash),index).find(event=>event.logIndex===row.transfer.logIndex)!;
  expect(event.class).toBe('ESCROW_COLLECTION');expect(event.price).toBeUndefined();expect(event.route).toBeUndefined();
});
test('the original delegation example is a paid escrow deposit',()=>{
  const tx=fixture.transactions.find(tx=>tx.hash==='0x6568b48b64c94150fcd68cb6e9be67e2ec0121e22894d852d63e93fe255837e8')!;
  expect(classifyTransaction(tx,fixture.logs.filter(log=>log.transactionHash===tx.hash),index)[0]?.class).toBe('ESCROW_DEPOSIT');
});
test('escrow records without payment corroboration stay unclassified',()=>{
  const partial=new EscrowIndex(fixture.input,transfers);
  expect(partial.resolve(native.transfer)).toBeUndefined();expect(partial.resolve(token.transfer)).toBeUndefined();
});
test('cancelled deals never acquire a seller or collection',()=>{for(const deal of index.deals.filter(deal=>deal.cancelled)){expect(deal.sold).toBeNull();expect(deal.collected).toBeNull();}});
test('escrow replay is independent of source array order',()=>{const reversed=build({...fixture.input,logs:[...fixture.input.logs].reverse()});expect(reversed.resolve(native.transfer)).toEqual(native.proof);});
// Damaged copies exercise validation; the stored source records remain untouched.
test('missing creation record is rejected',()=>{expect(()=>build({...fixture.input,logs:fixture.input.logs.filter(log=>log.transactionHash!==native.proof!.created.tx||log.logIndex!==native.proof!.created.logIndex)})).toThrow('DATA_ESCROW_GAP');});
test('duplicate escrow log is rejected',()=>{expect(()=>build({...fixture.input,logs:[...fixture.input.logs,fixture.input.logs[0]!]})).toThrow('DATA_ESCROW_DUPLICATE');});
test('wrong event emitter cannot supply escrow facts',()=>{expect(()=>build({...fixture.input,logs:fixture.input.logs.map((log,i)=>i===0?{...log,address:CHOG}:log)})).toThrow('DATA_ESCROW_LOG');});
test('original fetch time is required',()=>{expect(()=>build({...fixture.input,sources:{}})).toThrow('DATA_ESCROW_SOURCE');});
test('missing NFT deposit cannot become an escrow payment fact',()=>{expect(()=>new EscrowIndex(fixture.input,transfers.filter(transfer=>transfer!==native.transfer),{traces:fixture.traces,logs:fixture.logs})).toThrow('DATA_ESCROW_TRANSFER');});
test('a matching key does not permit changed transfer parties',()=>{expect(()=>index.resolve({...native.transfer,to:native.transfer.from})).toThrow('DATA_ESCROW_TRANSFER');});
test('missing token payment log is rejected',()=>{
  const proof=token.proof!.paymentProof;if(proof.kind!=='ERC20')throw new Error('Token proof missing');
  expect(()=>build(fixture.input,fixture.traces,fixture.logs.filter(log=>log.transactionHash!==proof.log.transactionHash||log.logIndex!==proof.log.logIndex))).toThrow('DATA_ESCROW_PAYMENT');
});
test('duplicate token payment cannot be counted twice',()=>{
  const proof=token.proof!.paymentProof;if(proof.kind!=='ERC20')throw new Error('Token proof missing');
  expect(()=>build(fixture.input,fixture.traces,[...fixture.logs,proof.log])).toThrow('DATA_ESCROW_PAYMENT');
});
test('reverted native payment is rejected',()=>{
  const proof=native.proof!.paymentProof;if(proof.kind!=='native')throw new Error('Native proof missing');
  const traces=structuredClone(fixture.traces);frame(traces[native.proof!.paid.tx]!.reply.result!,proof.transfer.path).error='execution reverted';
  expect(()=>build(fixture.input,traces)).toThrow('DATA_ESCROW_PAYMENT');
});
test('wrong native amount cannot pass deal verification',()=>{
  const proof=native.proof!.paymentProof;if(proof.kind!=='native')throw new Error('Native proof missing');
  const traces=structuredClone(fixture.traces);frame(traces[native.proof!.paid.tx]!.reply.result!,proof.transfer.path).value='0x0';
  expect(()=>build(fixture.input,traces)).toThrow('DATA_ESCROW_PAYMENT');
});
test('missing native value is an error instead of a zero default',()=>{
  const proof=native.proof!.paymentProof;if(proof.kind!=='native')throw new Error('Native proof missing');
  const trace=structuredClone(proof.source);delete frame(trace.reply.result!,proof.transfer.path).value;
  expect(()=>nativePayments(proof.transfer.tx,trace)).toThrow('DATA_TRACE_VALUE');
});
test('failed ancestor suppresses all its child payments',()=>{
  const proof=native.proof!.paymentProof;if(proof.kind!=='native')throw new Error('Native proof missing');
  const trace=structuredClone(proof.source);const parent=proof.transfer.path.slice(0,-1);frame(trace.reply.result!,parent).error='execution reverted';
  expect(nativePayments(proof.transfer.tx,trace).some(payment=>payment.path.join('.')===proof.transfer.path.join('.'))).toBe(false);
});
test('trace for another transaction is rejected',()=>{
  const proof=native.proof!.paymentProof;if(proof.kind!=='native')throw new Error('Native proof missing');
  expect(()=>nativePayments(native.proof!.created.tx,proof.source)).toThrow('DATA_TRACE_SOURCE');
});
