import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {assessRecord,type RecordInput,type CodeProof} from '../src/records.mts';
import {verifyFindingSources,type RpcEvidence} from '../src/evidence.mts';
const fixture=JSON.parse(await readFile(new URL('fixtures/source-evidence.json',import.meta.url),'utf8')) as {input:RecordInput;proof:CodeProof;execution:RpcEvidence;receipt:RpcEvidence};
const result=assessRecord(fixture.input,'0x'+fixture.input.log.topics[1]!.slice(-40),fixture.proof);
if(result.status!=='SYNTHETIC_RECORD')throw new Error('Expected real synthetic-record fixture');
const hash=result.proof.codeHash;
test('a real finding matches its independently fetched receipt and execution code',()=>{
 expect(verifyFindingSources(fixture.input,hash,fixture.execution,fixture.receipt)).toEqual([]);
});
test.each(['status','transactionHash','blockNumber','data','topics','address','removed','duplicate','missing'])('receipt alteration %s invalidates the finding',field=>{
 const source=structuredClone(fixture.receipt);
 const receipt=source.reply.result as any;
 const log=receipt.logs.find((log:any)=>Number(BigInt(log.logIndex))===fixture.input.log.logIndex);
 if(field==='status')receipt.status='0x0';
 if(field==='transactionHash')receipt.transactionHash='0x'+'0'.repeat(64);
 if(field==='blockNumber')receipt.blockNumber='0x1';
 if(field==='data')log.data='0x00';
 if(field==='topics')log.topics[1]='0x'+'0'.repeat(64);
 if(field==='address')log.address='0x'+'0'.repeat(40);
 if(field==='removed')log.removed=true;
 if(field==='duplicate')receipt.logs.push(structuredClone(log));
 if(field==='missing')receipt.logs=[];
 expect(verifyFindingSources(fixture.input,hash,fixture.execution,source).length).toBeGreaterThan(0);
});
test('wrong execution code, transaction, tracer and missing sources are rejected',()=>{
 for(const field of ['code','transaction','tracer','unavailable','date']){
  const source=structuredClone(fixture.execution);
  if(field==='code')(source.reply.result as any)[fixture.input.log.address].code='0x00';
  if(field==='transaction')source.request.params[0]='0x'+'0'.repeat(64);
  if(field==='tracer')source.request.params[1]={tracer:'callTracer'};
  if(field==='unavailable')source.reply={error:'Unavailable'};
  if(field==='date')source.fetchedAt='invalid';
  expect(verifyFindingSources(fixture.input,hash,source,fixture.receipt).length).toBeGreaterThan(0);
 }
});
test('malformed source data fails closed',()=>{
 expect(verifyFindingSources(fixture.input,hash,null as unknown as RpcEvidence,fixture.receipt)).toEqual(['INVALID_SOURCE']);
});
