export interface CallFrame {type:string;from:string;input?:string;to?:string;value?:string;error?:string;calls?:CallFrame[]}
export interface StoredTrace {fetchedAt:string;request:{method:string;params:unknown[]};reply:{result?:CallFrame;error?:unknown}}
export interface NativePayment {tx:string;from:string;to:string;amountWei:string;path:number[]}
const address=(value:unknown):value is string=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value);
export function nativePayments(tx:string,trace:StoredTrace):NativePayment[] {
  if(!/^0x[0-9a-f]{64}$/i.test(tx)||trace.request.method!=='debug_traceTransaction'||trace.request.params[0]!==tx||!Number.isFinite(Date.parse(trace.fetchedAt))||trace.reply.error||!trace.reply.result) throw new Error('DATA_TRACE_SOURCE: Missing or mismatched execution record');
  const root=trace.reply.result;
  if(root.error) throw new Error('DATA_TRACE_FAILED: Root transaction reverted');
  const payments:NativePayment[]=[];
  function visit(frame:CallFrame,path:number[]) {
    if(!frame||typeof frame.type!=='string'||!address(frame.from)) throw new Error('DATA_TRACE_FRAME: Malformed execution frame');
    if(frame.error) return; // All child changes are reverted with their ancestor.
    const type=frame.type.toUpperCase();
    if(!['CALL','CREATE','CREATE2','SELFDESTRUCT','STATICCALL','DELEGATECALL','CALLCODE'].includes(type)) throw new Error('DATA_TRACE_TYPE: Unsupported execution frame');
    if(['CALL','CREATE','CREATE2','SELFDESTRUCT'].includes(type)) {
      if(typeof frame.value!=='string'||!/^0x[0-9a-f]+$/i.test(frame.value)) throw new Error('DATA_TRACE_VALUE: Native value field missing');
      const value=BigInt(frame.value);
      if(value>0n) {
        if(!address(frame.to)) throw new Error('DATA_TRACE_ADDRESS: Native recipient missing');
        if(frame.from.toLowerCase()!==frame.to.toLowerCase())payments.push({tx,from:frame.from.toLowerCase(),to:frame.to.toLowerCase(),amountWei:value.toString(),path});
      }
    }
    if(frame.calls!==undefined&&!Array.isArray(frame.calls))throw new Error('DATA_TRACE_FRAME: Invalid child frames');
    for(const [index,child]of(frame.calls??[]).entries())visit(child,[...path,index]);
  }
  visit(root,[]);return payments;
}
