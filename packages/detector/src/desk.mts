export interface DeskData {
 wallets:string[];scope:{startTime:string;endTimeInclusive:string};
 findings:{tx:string;logIndex:number;token:string;result:{status:string;sender?:string;proof?:unknown;note?:string}}[];
 sourceChecks:{tx:string;logIndex:number;errors:string[]}[];
 symbolFindings:{address:string;shown?:string;normalized?:string;status:string}[];
}
export function lookupDesk(wallet:string,data:DeskData){
 if(!/^0x[0-9a-f]{40}$/i.test(wallet))throw new Error('DESK_WALLET: Enter a full Monad wallet address');
 const target=wallet.toLowerCase(),covered=data.wallets.some(item=>item.toLowerCase()===target);
 const verified=new Set(data.sourceChecks.filter(item=>item.errors.length===0).map(item=>`${item.tx.toLowerCase()}:${item.logIndex}`));
 const findings=data.findings.filter(item=>item.result.status==='SYNTHETIC_RECORD'&&item.result.sender?.toLowerCase()===target&&verified.has(`${item.tx.toLowerCase()}:${item.logIndex}`)).map(item=>({tx:item.tx,logIndex:item.logIndex,token:item.token,proof:item.result.proof,note:item.result.note,symbol:data.symbolFindings.find(token=>token.address.toLowerCase()===item.token.toLowerCase())??null}));
 return {wallet:target,status:!covered?'NOT_COVERED':findings.length?'PROVEN_RECORDS':'NO_PROVEN_FINDINGS',scope:data.scope,findings,
  note:!covered?'This wallet is outside the stored records. No clean-wallet or safety conclusion is available.':'This is a stored records window, not a live or complete wallet-safety scan. Unproven candidates are excluded.',
  advice:'A fake token can write history records in a wallet’s name. Do not copy token addresses from transaction history or interact with unknown tokens.'};
}
