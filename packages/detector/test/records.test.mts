import { test,expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assessRecord,assessSymbol,statelessEmitter,foldSymbol,type RecordInput,type CodeProof } from '../src/records.mts';
const fixtures=JSON.parse(await readFile(new URL('fixtures/real-records.json',import.meta.url),'utf8')) as {input:RecordInput;proof:CodeProof;contract:string}[];
const emitter=fixtures.find(row=>row.input.log.address==='0x5ecfed54e9c1724868e221a0604be291f0757d3e')!;
const inspect=(input:RecordInput,proof?:CodeProof)=>assessRecord(input,'0x'+input.log.topics[1]!.slice(-40),proof);
test('real stateless emitters bind caller arrays to the emitted record',()=>{
 for(const row of fixtures.filter(row=>['0x5ecfed54e9c1724868e221a0604be291f0757d3e','0x2794c3eba5686e4faba5647d1db3dddca1dfb933'].includes(row.input.log.address)))expect(inspect(row.input,row.proof).status).toBe('SYNTHETIC_RECORD');
});
test('the three real vault/redemption regressions never become synthetic records',()=>{
 for(const row of fixtures.filter(row=>row.contract))expect(assessRecord(row.input,row.input.tx.from,row.proof).status).toBe('NO_MATCH');
});
test('historical trace failure stays unproven rather than using latest code as history',()=>{const row=fixtures.find(row=>row.proof.historicalCode===null)!;expect(inspect(row.input,row.proof).status).toBe('REVIEW');});
test('signer mismatch without runtime evidence is not a finding',()=>{expect(inspect(emitter.input).status).toBe('REVIEW');});
test('changed current code invalidates the prior runtime proof',()=>{expect(inspect(emitter.input,{...emitter.proof,currentCode:'0x00'}).status).toBe('REVIEW');});
test('a proof for another contract cannot label this record',()=>{expect(inspect(emitter.input,{...emitter.proof,address:'0x'+'a'.repeat(40)}).status).toBe('REVIEW');});
test('the named sender signing its own transaction is not a forged record',()=>{const sender='0x'+emitter.input.log.topics[1]!.slice(-40);expect(inspect({...emitter.input,tx:{...emitter.input.tx,from:sender}},emitter.proof).status).toBe('NO_MATCH');});
test('router and delegation calls are not direct-token forgery evidence',()=>{expect(inspect({...emitter.input,tx:{...emitter.input.tx,to:'0x'+'b'.repeat(40)}},emitter.proof).status).toBe('NO_MATCH');});
test('a record must match the caller-supplied amount and parties exactly',()=>{expect(inspect({...emitter.input,log:{...emitter.input.log,data:'0x'+'0'.repeat(63)+'1'}},emitter.proof).status).toBe('REVIEW');});
test('approval and permit methods are never recognized as the tested arbitrary-record batch',()=>{for(const selector of ['0x23b872dd','0x095ea7b3','0xd505accf'])expect(inspect({...emitter.input,tx:{...emitter.input.tx,input:selector+emitter.input.tx.input.slice(10)}},emitter.proof).status).toBe('REVIEW');});
test('code with storage, external calls, delegation or creation is excluded',()=>{for(const row of fixtures.filter(row=>row.contract))expect(statelessEmitter(row.proof.currentCode)).toBe(false);});
test('padded and unpadded real log topics produce the same finding',()=>{expect(inspect({...emitter.input,log:{...emitter.input.log,topics:emitter.input.log.topics.filter(topic=>topic!==null)}},emitter.proof)).toEqual(inspect(emitter.input,emitter.proof));});
test('real combining marks normalize to expected symbols',()=>{for(const[from,to]of [['MỌN','MON'],['UṢDC','USDC'],['AUṢD','AUSD'],['WEṬH','WETH']])expect(foldSymbol(from!)).toBe(to);});
test('reference addresses are never flagged for their symbol',()=>{expect(assessSymbol(emitter.input.log.address,'MỌN',{MON:[emitter.input.log.address]}).status).toBe('REFERENCE_ADDRESS');});
test('unknown symbols and plain shared tickers do not produce a lookalike claim',()=>{expect(assessSymbol(emitter.input.log.address,'YZM',{}).status).toBe('UNLISTED_SYMBOL');expect(assessSymbol(emitter.input.log.address,'MON',{MON:['0x'+'0'.repeat(40)]}).status).toBe('SHARED_SYMBOL_REVIEW');});

test('an unrelated recipient cannot be labeled as the sender',()=>{expect(assessRecord(emitter.input,'0x'+emitter.input.log.topics[2]!.slice(-40),emitter.proof).status).toBe('NO_MATCH');});
