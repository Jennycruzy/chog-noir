import {test,expect} from 'vitest';
import {lookupDesk,type DeskData} from '../src/desk.mts';
const wallet='0x'+'12'.repeat(20),other='0x'+'34'.repeat(20);
const data:DeskData={wallets:[wallet],scope:{startTime:'2026-09-17T00:00:00Z',endTimeInclusive:'2026-10-17T00:00:00Z'},findings:[{tx:'tx1',logIndex:1,token:other,result:{status:'SYNTHETIC_RECORD',sender:wallet,proof:{reasons:['fixture proof']}}},{tx:'tx2',logIndex:2,token:other,result:{status:'REVIEW',sender:wallet}},{tx:'tx3',logIndex:3,token:other,result:{status:'SYNTHETIC_RECORD',sender:wallet}}],sourceChecks:[{tx:'tx1',logIndex:1,errors:[]},{tx:'tx3',logIndex:3,errors:['SOURCE_UNAVAILABLE']}],symbolFindings:[]};
test('only receipt-and-execution-verified synthetic records become public findings',()=>{const result=lookupDesk(wallet,data);expect(result.findings).toHaveLength(1);expect(result.findings[0]!.tx).toBe('tx1');});
test('an uncovered wallet never receives a clean-wallet claim',()=>{const result=lookupDesk(other,data);expect(result.status).toBe('NOT_COVERED');expect(result.note).toContain('No clean-wallet');});
test('invalid wallet input cannot become a lookup or path',()=>{expect(()=>lookupDesk('../../.env',data)).toThrow('Enter a full');});
