import {mkdir,open} from 'node:fs/promises';
import {join} from 'node:path';
import {decodeEventLog,encodeFunctionData,getAddress,keccak256,parseAbi,parseUnits,toBytes,type Address,type Hex,type PublicClient} from 'viem';
import config from '../../../config/cases.json' with {type:'json'};
import {CHOG_TOKEN} from '../../core/src/chain.mts';

export class BurnError extends Error {constructor(public readonly code:string,message:string,public readonly status=400){super(message);}}
export const DEAD='0x000000000000000000000000000000000000dEaD' as Address;
const tokenAbi=parseAbi(['function transfer(address to,uint256 amount) returns (bool)','function balanceOf(address owner) view returns (uint256)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const amount=()=>parseUnits(config.burnQuestions.amountChog,18);

/**
 * "Bribe the informant": a player burns $CHOG from its own wallet for one more question, at most twice per case.
 * The transfer carries a memo bound to the case, the Chog and the player's case session, so it can be credited once only.
 */
export class ChogBurns {
 constructor(private readonly options:{root:string;client:Pick<PublicClient,'getTransaction'|'getTransactionReceipt'|'getBlock'|'readContract'>}){}
 static memo(caseId:string,tokenId:number,nonce:string){return keccak256(toBytes(`chog-noir-burn:${caseId}:${tokenId}:${nonce}`));}
 /** The exact transaction the player's wallet sends: transfer(0x…dEaD, amount) followed by the 32-byte memo. */
 intent(caseId:string,tokenId:number,nonce:string){
  const data=encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[DEAD,amount()]})+ChogBurns.memo(caseId,tokenId,nonce).slice(2);
  return {to:getAddress(CHOG_TOKEN),data:data as Hex,amountChog:config.burnQuestions.amountChog};
 }
 private readonly stamps=new Map<string,{at:number;value:boolean}>();
 /** Any $CHOG at all earns the stamp; the balance is read from the token itself and reused for five minutes. */
 async holds(wallet:string){
  const owner=getAddress(wallet),saved=this.stamps.get(owner);if(saved&&Date.now()-saved.at<300_000)return saved.value;
  const value=(await this.options.client.readContract({address:getAddress(CHOG_TOKEN),abi:tokenAbi,functionName:'balanceOf',args:[owner]}))>0n;
  if(this.stamps.size>5000)this.stamps.clear();this.stamps.set(owner,{at:Date.now(),value});return value;
 }
 /** Credits a finalized burn exactly once. Only what reached 0x…dEaD from the player's wallet counts. */
 async verify(input:{tx:string;wallet:string;caseId:string;tokenId:number;nonce:string}){
  if(!/^0x[a-f0-9]{64}$/i.test(input.tx))throw new BurnError('BURN_NOT_FOUND',"We can't see that burn yet. It counts as soon as the chain shows it.");
  const hash=input.tx.toLowerCase() as Hex,wallet=getAddress(input.wallet),expected=this.intent(input.caseId,input.tokenId,input.nonce);
  const [transaction,receipt,finalized]=await Promise.all([this.options.client.getTransaction({hash}).catch(()=>null),this.options.client.getTransactionReceipt({hash}).catch(()=>null),this.options.client.getBlock({blockTag:'finalized'})]);
  if(!transaction||!receipt||receipt.blockNumber>finalized.number)throw new BurnError('BURN_NOT_FOUND',"We can't see that burn yet. It counts as soon as the chain shows it.",409);
  if(receipt.status!=='success'||getAddress(transaction.from)!==wallet||!transaction.to||getAddress(transaction.to)!==expected.to||transaction.input.toLowerCase()!==expected.data.toLowerCase())throw new BurnError('BURN_INVALID','That transaction is not the burn for this case and Chog.');
  let burned=0n;
  for(const log of receipt.logs){
   if(getAddress(log.address)!==expected.to)continue;
   try{const event=decodeEventLog({abi:tokenAbi,topics:log.topics,data:log.data});if(event.eventName==='Transfer'&&getAddress(event.args.from)===wallet&&getAddress(event.args.to)===DEAD)burned+=event.args.value;}catch{}
  }
  if(burned<amount())throw new BurnError('BURN_INVALID','Less $CHOG reached 0x…dEaD than the bribe requires.');
  // One credit per transaction, ever: the record is created exclusively.
  const directory=join(this.options.root,'runs/burns');await mkdir(directory,{recursive:true,mode:0o700});
  try{const file=await open(join(directory,hash+'.json'),'wx',0o600);try{await file.writeFile(JSON.stringify({tx:hash,wallet,caseId:input.caseId,tokenId:input.tokenId,burnedWei:burned.toString(),block:receipt.blockNumber.toString()}));}finally{await file.close();}}
  catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new BurnError('BURN_ALREADY_USED','That burn has already been credited.',409);throw error;}
  return {tx:hash,burnedWei:burned.toString()};
 }
}
