import {formatEther,keccak256,toBytes} from 'viem';
import config from '../../../config/cases.json' with {type:'json'};
import type {LieKind,PuzzleReceipt} from '../../cases/src/puzzle.mts';
import type {Metadata} from '../../cases/src/build.mts';
import type {EnrichedEvent,Source} from '../../core/src/enrich.mts';
import {buildOwnership,type Ownership} from '../../core/src/owners.mts';
import {classifyTransaction} from '../../core/src/classify.mts';
import {nativePayments} from '../../core/src/native-payments.mts';
import {ownerDirectory,type OwnerSnapshot} from '../../auth/src/holders.mts';
import {CHOG_TOKEN,ESCROW,TRANSFER_TOPIC,ZERO,type ChainTransaction,type ChainLog} from '../../core/src/chain.mts';

export const lieKinds:readonly LieKind[]=['D1','D2','D3','D4','D5','D6','I1','I2','I3','I4','I5','I6'];
export interface ClaimCandidate {
 id:string;kind:LieKind;tokenId:number;factId:string;trueValue:string;falseValue:string;
 receipt:PuzzleReceipt;inference:string;unlockLine:string;relatedTokenIds:number[];
}
export interface BulkSource {transaction:ChainTransaction;logs:ChainLog[];fetchedAt:string}
export class ClaimSourceError extends Error {constructor(public readonly code:string,message:string){super(message);}}
const source=(row:EnrichedEvent):Source=>({tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex});
const key=(row:Source)=>row.tx.toLowerCase()+':'+row.logIndex;
const compare=(a:Source,b:Source)=>a.block-b.block||a.logIndex-b.logIndex;
const timeText=(at:number)=>new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC',hour12:false}).format(new Date(at*1000))+' UTC';
const amountText=(wei:string,asset:string,exact=false)=>(exact||asset==='$CHOG')?formatEther(BigInt(wei))+' '+asset:'about '+((BigInt(wei)+25n*10n**18n)/(50n*10n**18n)*50n).toLocaleString('en-US')+' '+asset;
const unique=(rows:Source[])=>[...new Map(rows.map(row=>[key(row),row])).values()].sort(compare);
const problem=(code:string,message:string):never=>{throw new ClaimSourceError(code,message);};

export function noirWalletLabels(wallets:readonly string[],salt:string){
 if(!/^0x[a-f0-9]{64}$/i.test(salt))return problem('CLAIM_SALT_INVALID','A complete case salt is required.');
 const moods=['Quiet','Late','Early','Distant','Silent','Patient','Restless','Midnight','Rainy','Wandering','Hidden','Steady','Watchful','Northern','Southern','Drifting'];
 const colours=['Amber','Silver','Copper','Crimson','Violet','Blue','Golden','Ivory','Scarlet','Indigo','Green','Grey','White','Red','Purple','Bronze'];
 const roles=['Collector','Courier','Reader','Keeper','Traveller','Archivist','Wanderer','Visitor','Painter','Scout','Drifter','Watcher','Messenger','Walker','Clerk','Regular'];
 const words=moods.flatMap(mood=>colours.flatMap(colour=>roles.map(role=>'The '+mood+' '+colour+' '+role))),used=new Set<string>(),labels=new Map<string,string>();
 const addresses=[...new Set(wallets.map(wallet=>wallet.toLowerCase()))].sort();
 if(addresses.length>words.length||addresses.some(wallet=>!/^0x[a-f0-9]{40}$/.test(wallet)))return problem('CLAIM_WALLETS_INVALID','The case wallet list is invalid or too large.');
 for(const wallet of addresses){let index=Number(BigInt(keccak256(toBytes(salt+wallet)))%BigInt(words.length));while(used.has(words[index]!))index=(index+1)%words.length;const label=words[index]!;used.add(label);labels.set(wallet,label);}
 return labels;
}

/** A shared signed action proves an on-chain link, never common ownership or identity. */
export function verifiedBulkCompanions(saved:BulkSource){
 if(!Number.isFinite(Date.parse(saved.fetchedAt)))return problem('CLAIM_BULK_SOURCE','A stored transaction fetch time is required.');
 const classified=classifyTransaction(saved.transaction,saved.logs),groups=new Map<string,typeof classified>();
 for(const row of classified)if(row.class==='BULK_MOVE'&&row.from===saved.transaction.from.toLowerCase()&&row.from!==row.to){
  const route=row.from+':'+row.to;groups.set(route,[...(groups.get(route)??[]),row]);
 }
 return [...groups.values()].filter(rows=>new Set(rows.map(row=>row.tokenId)).size>=2);
}

export class ClaimCatalog {
 private readonly rows:EnrichedEvent[];
 private readonly current=new Map<number,Ownership>();
 private readonly timelines=new Map<number,Ownership[]>();
 private readonly histories=new Map<number,EnrichedEvent[]>();
 private readonly recorded=new Map<string,EnrichedEvent>();
 private readonly chogPayments=new Map<string,EnrichedEvent[]>();
 private readonly bulk=new Map<string,ReturnType<typeof verifiedBulkCompanions>>();
 constructor(private readonly input:{history:readonly EnrichedEvent[];times:ReadonlyMap<number,number>;metadata:ReadonlyMap<number,Metadata>;cutoff:Source;ownership:OwnerSnapshot;walletLabels:ReadonlyMap<string,string>;bulkSources?:readonly BulkSource[]}){
  this.input={...input,cutoff:{...input.cutoff}};
  this.rows=input.history.filter(row=>compare(source(row),input.cutoff)<=0).sort((a,b)=>compare(source(a),source(b)));
  ownerDirectory(input.ownership);
  if(new Set(input.walletLabels.values()).size!==input.walletLabels.size)return problem('CLAIM_NICKNAME_COLLISION','Different case wallets need distinct nicknames.');
  if(input.cutoff.block>input.ownership.indexedBlock)return problem('CLAIM_HISTORY_BEHIND','Independent ownership history must cover the case cutoff.');
  if(!this.rows.some(row=>key(source(row))===key(input.cutoff)))return problem('CLAIM_CUTOFF_MISSING','The case cutoff must be a stored event.');
  const ownership=buildOwnership(this.rows.map(row=>row.event),input.times);
  for(const row of ownership){this.timelines.set(row.tokenId,[...(this.timelines.get(row.tokenId)??[]),row]);if(row.departure===null)this.current.set(row.tokenId,row);}
  for(const row of this.rows){
   this.histories.set(row.event.tokenId,[...(this.histories.get(row.event.tokenId)??[]),row]);this.recorded.set(key(source(row)),row);
   if(row.event.class==='ESCROW_DEPOSIT'&&row.event.escrow?.paymentToken===CHOG_TOKEN){const wallet=row.event.escrow.seller;this.chogPayments.set(wallet,[...(this.chogPayments.get(wallet)??[]),row]);}
  }
  const ids=new Set(this.rows.map(row=>row.event.tokenId)),raw=new Map(input.ownership.transfers.filter(row=>ids.has(row.tokenId)&&compare(row,input.cutoff)<=0).map(row=>[key(row),row])),rawTimes=new Map(input.ownership.blockTimes);
  if(raw.size!==this.rows.length)return problem('CLAIM_HISTORY_COVERAGE','Classified history must contain every indexed transfer for its tokens.');
  for(const row of this.rows){const stored=raw.get(key(source(row))),at=rawTimes.get(row.event.block);if(!stored||stored.block!==row.event.block||stored.tokenId!==row.event.tokenId||stored.from.toLowerCase()!==row.event.from||stored.to.toLowerCase()!==row.event.to||at!==input.times.get(row.event.block))return problem('CLAIM_HISTORY_COVERAGE','Classified history disagrees with independent transfer records.');}
  for(const saved of input.bulkSources??[]){
   if(saved.transaction.blockNumber>input.cutoff.block)continue;
   const groups=verifiedBulkCompanions(saved);
   for(const group of groups)for(const event of group){
    const stored=this.rows.find(row=>key(source(row))===key(event));
    if(stored&&(stored.event.class!=='BULK_MOVE'||stored.event.from!==event.from||stored.event.to!==event.to||stored.event.tokenId!==event.tokenId||stored.event.block!==event.block))return problem('CLAIM_BULK_MISMATCH','The bulk transaction disagrees with stored history.');
   }
   this.bulk.set(saved.transaction.hash.toLowerCase(),groups);
  }
 }
 private name(id:number){const name=this.input.metadata.get(id)?.name;if(typeof name!=='string'||!name.trim()||name.length>80)return problem('CLAIM_METADATA_MISSING','A stored Chog metadata name is required.');return name;}
 private label(wallet:string){const label=this.input.walletLabels.get(wallet.toLowerCase());if(!label||label.length>80||/0x[a-f0-9]{40}/i.test(label))return problem('CLAIM_WALLET_LABEL','A clean wallet nickname is required.');return label;}
 get cutoff(){return {...this.input.cutoff};}
 private time(block:number){const at=this.input.times.get(block);if(at===undefined||!Number.isSafeInteger(at)||at<0)return problem('CLAIM_TIME_MISSING','A stored source block time is required.');return at;}
 private allowed(row:Source){return compare(row,this.input.cutoff)<=0||row.block===this.input.cutoff.block&&row.tx===this.input.cutoff.tx;}
 private paid(row:EnrichedEvent){
  const event=row.event;
  if(event.class==='SALE'){
   const price=event.price;
   if(!price||price.status!=='EXACT'||!price.grossWei||!price.sellerProceedsWei||!/^\d+$/.test(price.grossWei)||!/^\d+$/.test(price.sellerProceedsWei)||BigInt(price.grossWei)<=0n||BigInt(price.sellerProceedsWei)<=0n||BigInt(price.sellerProceedsWei)>BigInt(price.grossWei)||!event.evidence.orderLogIndices.length)return null;
   return {asset:price.asset,gross:price.grossWei,seller:price.sellerProceedsWei,wallet:event.from,sources:unique([source(row),...event.evidence.orderLogIndices.map(logIndex=>({tx:event.tx,block:event.block,logIndex}))])};
  }
  const escrow=event.escrow;
  if(event.class!=='ESCROW_DEPOSIT'||!escrow||escrow.role!=='deposit'||!escrow.paymentAtThisTransfer||!/^\d+$/.test(escrow.amountWei)||BigInt(escrow.amountWei)<=0n||escrow.paid.tx!==event.tx||escrow.seller!==event.from||escrow.paid.block!==event.block)return null;
  if(escrow.paymentProof.kind==='ERC20'){
   const log=escrow.paymentProof.log;
   if(log.removed||log.address.toLowerCase()!==escrow.paymentToken||(log.topics.length<3||log.topics.slice(3).some(topic=>topic!==null&&topic!==undefined))||log.topics[0]!==TRANSFER_TOPIC||log.transactionHash!==event.tx||log.blockNumber!==event.block||!/^0x[0-9a-f]{64}$/i.test(log.data)||!/^0x0{24}[0-9a-f]{40}$/i.test(log.topics[1]!)||!/^0x0{24}[0-9a-f]{40}$/i.test(log.topics[2]!)||'0x'+log.topics[1]!.slice(-40)!==ESCROW||'0x'+log.topics[2]!.slice(-40)!==escrow.seller||BigInt(log.data).toString()!==escrow.amountWei)return null;
   return {asset:escrow.paymentToken===CHOG_TOKEN?'$CHOG':escrow.paymentToken==='0x3bd359c1119da7da1d913d1c4d2b7c461115433a'?'WMON':null,gross:escrow.amountWei,seller:escrow.amountWei,wallet:escrow.seller,sources:unique([source(row),{tx:log.transactionHash,block:log.blockNumber,logIndex:log.logIndex}])};
  }
  const native=escrow.paymentProof.transfer;
  if(escrow.paymentToken!==ZERO||native.from!==ESCROW||native.to!==escrow.seller||native.amountWei!==escrow.amountWei||escrow.paymentProof.source.reply.error||!escrow.paymentProof.source.reply.result)return null;
  if(!nativePayments(event.tx,escrow.paymentProof.source).some(row=>row.from===native.from&&row.to===native.to&&row.amountWei===native.amountWei&&JSON.stringify(row.path)===JSON.stringify(native.path)))return null;
  return {asset:'MON',gross:escrow.amountWei,seller:escrow.amountWei,wallet:escrow.seller,sources:unique([source(row),{tx:escrow.paid.tx,block:escrow.paid.block,logIndex:escrow.paid.logIndex}])};
 }
 forToken(tokenId:number,peers:readonly number[]){
  const name=this.name(tokenId),current=this.current.get(tokenId),history=this.histories.get(tokenId)??[],timeline=this.timelines.get(tokenId)??[],claims:ClaimCandidate[]=[],unavailable:{kind:LieKind;tokenId:number;reason:string}[]=[];
  if(!current||!history.length)return problem('CLAIM_OWNER_MISSING','The witness needs a current source-backed owner.');
  const arrival=history.find(row=>key(source(row))===key(current.arrival))!,at=this.time(arrival.event.block),mint=history.find(row=>row.event.from===ZERO);
  if(!mint)return problem('CLAIM_MINT_MISSING','A continuous history from mint is required.');
  const add=(kind:LieKind,trueValue:string,falseValue:string,text:string,sources:Source[],inference:string,unlockLine:string,relatedTokenIds:number[]=[],exactText=text)=>{
   const proof=unique(sources);if(!proof.length||proof.some(row=>!this.allowed(row)))return problem('CLAIM_FUTURE_SOURCE','Claim evidence must be available at the case cutoff.');
   if(proof.some(row=>this.recorded.get(key(row))?.event.class==='UNCLASSIFIED'))return;
   const factId='claim-'+kind+'-'+tokenId,id=keccak256(toBytes(kind+':'+tokenId+':'+proof.map(key).join('|'))).slice(0,22);
   claims.push({id,kind,tokenId,factId,trueValue,falseValue,inference,unlockLine,relatedTokenIds,receipt:{id:'proof-'+id,text,exactText,at:Math.max(...proof.map(row=>this.time(row.block))),sources:proof,sealed:false,facts:[{id:factId,value:trueValue}]}});
  };
  if(arrival.event.class!=='UNCLASSIFIED')add('D1',name+' reached its new wallet on '+timeText(at),name+' reached its new wallet on '+timeText(at-86400),name+' reached its new wallet on '+timeText(at)+'.',[current.arrival],'The arrival receipt puts the move on a different day.','The receipt fixes the arrival time.');
  const payment=this.paid(arrival);
  if(payment?.asset){
   const recipient=this.label(payment.wallet),text=name+' · Paid: '+amountText(payment.gross,payment.asset)+'. '+recipient+' received '+amountText(payment.seller,payment.asset)+' in the same transaction.',exact=name+' · Paid: '+amountText(payment.gross,payment.asset,true)+'. '+recipient+' received '+amountText(payment.seller,payment.asset,true)+' in the same transaction.';
   add('D2',name+' moved with a verified payment',name+' moved with no payment',text,payment.sources,'The same transaction contains a verified payment.','A payment is recorded alongside the move.',[],exact);
   add('I1',name+' changed wallets in a paid purchase',name+' arrived as a gift',text,payment.sources,'The seller received payment in the same transaction, so this was a purchase.','The payment explains the move.',[],exact);
   if(['MON','WMON'].includes(payment.asset)){
    const units=(BigInt(payment.gross)+25n*10n**18n)/(50n*10n**18n)*50n,bounds=config.priceBandUpperMon.map(BigInt),index=bounds.findIndex(bound=>units<bound),band=index<0?bounds.length:index;
    const falsePrice=(band===0?bounds[0]!+500n:bounds[band-1]!-500n)*10n**18n;
    add('D5',name+' was paid for with '+amountText(payment.gross,payment.asset),name+' was paid for with '+amountText(falsePrice.toString(),payment.asset),text,payment.sources,'The receipt records a different amount.','The receipt fixes the payment amount.',[],exact);
   }
  }
  const owners=[...new Set(timeline.map(row=>row.owner))];
  add('D3',name+' has '+owners.length+' recorded owners',name+' has '+(owners.length===1?2:owners.length-1)+' recorded owners',name+' passed through '+owners.map(wallet=>this.label(wallet)).join(', ')+': '+owners.length+' recorded owners.',timeline.map(row=>row.arrival),'The complete owner receipts contain a different count.','The owner trail is complete from mint.');
  if(current.arrival.from!==ZERO&&current.arrival.from!==current.arrival.to&&arrival.event.class!=='UNCLASSIFIED'){
   const old=this.label(current.arrival.from),now=this.label(current.owner);
   if(old===now)return problem('CLAIM_NICKNAME_COLLISION','The case needs different nicknames for different wallets.');
   add('D4',name+' moved from '+old+' to '+now,name+' always stayed with '+now,name+' moved from '+old+' to '+now+'.',[current.arrival],'The sending wallet differs from the receiving wallet.','The transfer names both sides of the move.');
   const previous=timeline.find(row=>row.owner!==current.owner&&row.departure!==null&&compare(row.departure,current.arrival)<=0);
   if(previous)add('D6',name+' lived in another wallet before this arrival',name+' came straight from mint to this wallet',name+' lived with '+this.label(previous.owner)+' before reaching '+now+'.',[mint.event,previous.arrival,current.arrival],'An earlier owner receipt rules out a direct arrival from mint.','An earlier wallet is part of the trail.');
  }
  const earliest=this.timelines.get(tokenId)![0]!;
  if(timeline.length===2&&earliest.arrival.from===ZERO&&earliest.departure&&key(earliest.departure)===key(current.arrival)&&arrival.event.class!=='UNCLASSIFIED')add('I4',name+' made its first move since mint',name+' changed wallets many times before this move',name+' stayed in its mint wallet until this move.',[earliest.arrival,current.arrival],'The mint and the sole later move leave no earlier handover.','This was the first move since mint.');
  const roommates=peers.filter(id=>id!==tokenId&&this.current.get(id)?.owner===current.owner).sort((a,b)=>a-b);
  const earlier=roommates.find(id=>this.time(this.current.get(id)!.arrival.block)<Math.floor(at/60)*60);
  if(earlier!==undefined){const peer=this.current.get(earlier)!,other=this.name(earlier),otherAt=this.time(peer.arrival.block);add('I2',name+' reached this wallet after '+other,name+' reached this wallet before '+other,other+' arrived on '+timeText(otherAt)+'. '+name+' arrived on '+timeText(at)+'.',[peer.arrival,current.arrival],'Compare the arrival times: the other Chog arrived earlier.','The arrival order is fixed by the receipts.',[earlier]);}
  if(roommates.length){const id=roommates[0]!,peer=this.current.get(id)!,other=this.name(id);add('I5',name+' shares its wallet with '+other,name+' is the sole Chog in this wallet',name+' and '+other+' both reached '+this.label(current.owner)+' and remain there at the cutoff.',[peer.arrival,current.arrival],'Another Chog is recorded in the same wallet at the cutoff.','The wallet has another Chog in it.',[id]);}
  for(const row of history){
   const group=this.bulk.get(row.event.tx)?.find(group=>group.some(event=>key(event)===key(source(row))));
   const companion=group?.find(event=>event.tokenId!==tokenId&&compare(event,this.input.cutoff)<=0&&this.recorded.has(key(event)));
   if(companion){const other=this.name(companion.tokenId);add('I3',name+' shared a signed bulk move with '+other,name+' never shared a signed bulk move with '+other,name+' and '+other+' moved from '+this.label(row.event.from)+' to '+this.label(row.event.to)+' in the same sender-signed bulk action.',[source(row),companion],'The same signed bulk action links these moves; it does not establish common ownership.','The two Chogs travelled in the same signed move.',[companion.tokenId]);break;}
  }
  for(const row of this.chogPayments.get(current.owner)??[]){
   const paid=this.paid(row);if(paid?.asset!=='$CHOG'||paid.wallet!==current.owner)continue;
   const owner=this.label(current.owner),text=owner+' received '+amountText(paid.seller,'$CHOG')+' through escrow in the recorded deal for '+this.name(row.event.tokenId)+'.',exact=owner+' received '+amountText(paid.seller,'$CHOG',true)+' through escrow in the recorded deal for '+this.name(row.event.tokenId)+'.';
   add('I6',name+"'s owner received $CHOG through escrow",name+"'s owner never touched $CHOG",text,unique([...paid.sources,current.arrival]),'The official token receipt pays the wallet that holds this witness.','The token payment connects the wallet to the deal.',[row.event.tokenId],exact);break;
  }
  for(const kind of lieKinds)if(!claims.some(row=>row.kind===kind))unavailable.push({kind,tokenId,reason:'CLAIM_PROOF_UNAVAILABLE'});
  return {claims,unavailable};
 }
}
