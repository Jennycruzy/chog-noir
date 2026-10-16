import {assessPaymentWindow,type PaymentWindowInput} from '../core/src/payment-window.mts';
import {storeEscrowDeals} from './escrow-deals.mts';
import {EscrowIndex,type EscrowInput} from '../core/src/escrow.mts';
import {type StoredTrace} from '../core/src/native-payments.mts';
import { createHash } from 'node:crypto';
import { classifyTransaction } from '../core/src/classify.mts';
import { enrichHistory } from '../core/src/enrich.mts';
import { buildOwnership } from '../core/src/owners.mts';
import { CHOG, TRANSFER_TOPIC, decodeTransfer, type ChainLog, type ChainTransaction } from '../core/src/chain.mts';
import type { DatabaseConnection } from './migrate.mts';

export interface HistoryInput {
  paymentWindows?:PaymentWindowInput[];
  escrow?: {input:EscrowInput;traces:Record<string,StoredTrace>};
  fetchedAt: string;
  sources: { transactions: Record<string,{fetchedAt:string;request:unknown}>; blocks: Record<string,{fetchedAt:string;request:unknown}> };
  toBlockExclusive: number;
  blocks: { number: number; hash: string; timestamp: number }[];
  transactions: (ChainTransaction & { value: string; status: number })[];
  logs: ChainLog[];
  metadata: { tokenId: number; uri: string; fetchedAt: string; metadata: { name: string; image: string; attributes: unknown[] } }[];
}
async function insert(database: DatabaseConnection, table: string, columns: string[], rows: unknown[][], keys: string[], compare = columns): Promise<void> {
  // All identifiers come from the fixed table definitions below; values are parameters.
  for (let offset=0;offset<rows.length;offset+=150) {
    const batch=rows.slice(offset,offset+150);
    const values=batch.flat();
    const placeholders=batch.map((row,index)=>`(${row.map((_,column)=>`$${index*columns.length+column+1}`).join(',')})`).join(',');
    const equality=compare.map(column=>`${table}.${column} IS NOT DISTINCT FROM EXCLUDED.${column}`).join(' AND ');
    const result=await database.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders} ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${keys[0]}=EXCLUDED.${keys[0]} WHERE ${equality} RETURNING ${keys[0]}`,values) as {rows:unknown[]};
    if(result.rows.length!==batch.length) throw new Error(`DB_SOURCE_CONFLICT: Stored ${table} records differ from the import`);
  }
}
export async function importHistory(database: DatabaseConnection, input: HistoryInput, options:{reclassify?:boolean}={}) {
  if (!Number.isFinite(Date.parse(input.fetchedAt)) || !Number.isSafeInteger(input.toBlockExclusive) || input.toBlockExclusive<=0) throw new Error('DATA_IMPORT: Invalid snapshot boundary or fetch time');
  const unique = <T,>(rows:readonly T[], key:(row:T)=>string|number, name:string) => {
    const result=new Map(rows.map(row=>[key(row),row]));
    if(result.size!==rows.length) throw new Error(`DATA_IMPORT: Duplicate ${name}`);
    return result;
  };
  if(!input.sources?.transactions||!input.sources?.blocks) throw new Error('DATA_SOURCE: Original API sources are missing');
  const source = (entry: {fetchedAt:string;request:unknown} | undefined) => {
    if(!entry||!Number.isFinite(Date.parse(entry.fetchedAt))||!entry.request||typeof entry.request!=='object'||Array.isArray(entry.request)) throw new Error('DATA_SOURCE: Original API request and fetch time are required');
    return entry;
  };
  for(const tx of input.transactions) source(input.sources.transactions[tx.hash.toLowerCase()]);
  for(const block of input.blocks) source(input.sources.blocks[block.number]);
  const blocks=unique(input.blocks,block=>block.number,'block');
  const transactions=unique(input.transactions,tx=>tx.hash.toLowerCase(),'transaction');
  const metadata=unique(input.metadata,item=>item.tokenId,'metadata');
  const logs=unique(input.logs,log=>`${log.transactionHash.toLowerCase()}:${log.logIndex}`,'log');
  for (const block of blocks.values()) if(!Number.isSafeInteger(block.number)||block.number<0||block.number>=input.toBlockExclusive||!/^0x[0-9a-f]{64}$/i.test(block.hash)||!Number.isSafeInteger(block.timestamp)||block.timestamp<0) throw new Error('DATA_IMPORT: Invalid block');
  const byTx=new Map<string,ChainLog[]>();
  for(const log of logs.values()) {
    if(!transactions.has(log.transactionHash.toLowerCase())) throw new Error('DATA_IMPORT: Log transaction missing');
    const list=byTx.get(log.transactionHash.toLowerCase())??[];
    list.push(log);byTx.set(log.transactionHash.toLowerCase(),list);
  }
  if(input.escrow&&input.escrow.input.toBlockExclusive!==input.toBlockExclusive)throw new Error('DATA_ESCROW_COVERAGE: NFT and escrow snapshot boundaries differ');
  const escrow=input.escrow?new EscrowIndex(input.escrow.input,input.logs.filter(log=>log.address.toLowerCase()===CHOG&&log.topics[0]===TRANSFER_TOPIC).map(decodeTransfer),{traces:input.escrow.traces,logs:input.logs}):undefined;
  const events=input.transactions.flatMap(tx=>{
    if(!blocks.has(tx.blockNumber)||tx.status!==1||!/^\d+$/.test(tx.value)) throw new Error('DATA_IMPORT: Invalid transaction source');
    return classifyTransaction(tx,byTx.get(tx.hash.toLowerCase())??[],escrow);
  });
  const windows=new Map<string,{input:PaymentWindowInput;assessment:ReturnType<typeof assessPaymentWindow>}>();
  for(const window of input.paymentWindows??[]) {
    const event=events.find(event=>event.tx===window.transfer.tx&&event.logIndex===window.transfer.logIndex);
    if(!event||event.block!==window.transfer.block||event.tokenId!==window.transfer.tokenId||event.from!==window.transfer.from||event.to!==window.transfer.to)throw new Error('DATA_PAYMENT_SOURCE: Payment window does not match indexed transfer');
    const key=`${event.tx}:${event.logIndex}`;if(windows.has(key))throw new Error('DATA_PAYMENT_SOURCE: Duplicate payment window');
    windows.set(key,{input:window,assessment:assessPaymentWindow(window)});
  }
  const tokenIds=new Set(events.map(event=>event.tokenId));
  if(tokenIds.size!==metadata.size) throw new Error('DATA_IMPORT: Metadata and indexed token sets do not match');
  for(const tokenId of tokenIds) if(!metadata.has(tokenId)) throw new Error('DATA_IMPORT: Token metadata missing');
  for(const item of input.metadata) if(!Number.isInteger(item.tokenId)||item.tokenId<1||item.tokenId>1969||!item.uri||!item.metadata.name||!item.metadata.image||!Array.isArray(item.metadata.attributes)||!Number.isFinite(Date.parse(item.fetchedAt))) throw new Error('DATA_IMPORT: Invalid metadata');
  const times=new Map(input.blocks.map(block=>[block.number,block.timestamp]));
  const owners=buildOwnership(events,times);
  const enriched=new Map(enrichHistory(events,times).map(({event,...facts})=>[`${event.tx}:${event.logIndex}`,facts]));
  if(!events.length) throw new Error('DATA_IMPORT: Snapshot has no Chog transfers');
  const snapshotHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const generatedAt=new Date().toISOString();
  await database.exec('BEGIN');
  try {
    await database.exec('LOCK TABLE indexer_progress IN EXCLUSIVE MODE');
    const progress=await database.query("SELECT last_block FROM indexer_progress WHERE stream='chog-history'") as {rows:{last_block:string|number}[]};
    const highestBlock=Math.max(...events.map(event=>event.block));
    if(progress.rows[0] && Number(progress.rows[0].last_block)>highestBlock) throw new Error('DATA_IMPORT_STALE: Import would move indexing backwards');
    await insert(database,'chain_blocks',['number','hash','occurred_at','fetched_at'],input.blocks.map(block=>[block.number,block.hash.toLowerCase(),new Date(block.timestamp*1000).toISOString(),source(input.sources.blocks[block.number]).fetchedAt]),['number'],['hash','occurred_at']);
    await insert(database,'chain_transactions',['hash','block_number','signer','destination','input','value_wei','receipt','fetched_at','source_record'],input.transactions.map(tx=>[tx.hash.toLowerCase(),tx.blockNumber,tx.from.toLowerCase(),tx.to?.toLowerCase()??null,tx.input.toLowerCase(),tx.value,null,source(input.sources.transactions[tx.hash.toLowerCase()]).fetchedAt,{provider:'HyperSync',...source(input.sources.transactions[tx.hash.toLowerCase()]),endpoint:'https://monad.hypersync.xyz',snapshotHash,transaction:tx}]),['hash'],['block_number','signer','destination','input','value_wei']);
    await insert(database,'chogs',['token_id','metadata_uri','metadata_name','image_uri','metadata','metadata_fetched_at'],input.metadata.map(item=>[item.tokenId,item.uri,item.metadata.name,item.metadata.image,item.metadata,item.fetchedAt]),['token_id'],['metadata_uri','metadata_name','image_uri','metadata']);
    const rawTransfers=[...logs.values()].filter(log=>log.address.toLowerCase()===CHOG&&log.topics[0]?.toLowerCase()===TRANSFER_TOPIC);
    const transferSources=new Map(rawTransfers.map(log=>[`${log.transactionHash.toLowerCase()}:${log.logIndex}`,log]));
    await insert(database,'transfers',['tx_hash','log_index','token_id','from_address','to_address','raw_log'],events.map(event=>[event.tx,event.logIndex,event.tokenId,event.from,event.to,transferSources.get(`${event.tx}:${event.logIndex}`)]),['tx_hash','log_index']);
    if(options.reclassify) {
      await database.query('DELETE FROM sales USING transfers WHERE sales.tx_hash=transfers.tx_hash AND sales.log_index=transfers.log_index AND transfers.token_id=ANY($1::integer[])',[[...tokenIds]]);
      await database.query('DELETE FROM escrow_movements USING transfers WHERE escrow_movements.tx_hash=transfers.tx_hash AND escrow_movements.log_index=transfers.log_index AND transfers.token_id=ANY($1::integer[])',[[...tokenIds]]);
      await database.query('DELETE FROM events_classified USING transfers WHERE events_classified.tx_hash=transfers.tx_hash AND events_classified.log_index=transfers.log_index AND transfers.token_id=ANY($1::integer[])',[[...tokenIds]]);
    }
    await insert(database,'events_classified',['tx_hash','log_index','classification','rule','reason','evidence','classifier_version','classified_at'],events.map(event=>[event.tx,event.logIndex,event.class,event.rule,event.reason,{...event.evidence,...(event.escrow?{escrow:event.escrow}:{}),facts:{...enriched.get(`${event.tx}:${event.logIndex}`),paymentWindow:windows.get(`${event.tx}:${event.logIndex}`)??{status:'NOT_CHECKED',reason:'Complete payment-window history has not been collected'}},logs:(byTx.get(event.tx)??[]).filter(log=>event.evidence.orderLogIndices.includes(log.logIndex))},2,generatedAt]),['tx_hash','log_index'],['classification','rule','reason','evidence','classifier_version']);
    const sales=events.filter(event=>event.class==='SALE');
    await insert(database,'sales',['tx_hash','log_index','route','asset','gross_wei','seller_proceeds_wei','fees_wei','price_status','payment_evidence'],sales.map(event=>{
      if(!event.price||!event.route) throw new Error('DATA_IMPORT: Sale price evidence missing');
      return [event.tx,event.logIndex,event.route,event.price.asset,event.price.grossWei,event.price.sellerProceedsWei,event.price.feesWei,event.price.status,event.evidence];
    }),['tx_hash','log_index']);
    if(escrow) {
      await storeEscrowDeals(database,escrow.deals);
      await insert(database,'escrow_movements',['tx_hash','log_index','deal_id','role','proof'],events.filter(event=>event.escrow).map(event=>[event.tx,event.logIndex,event.escrow!.dealId,event.escrow!.role,event.escrow]),['tx_hash','log_index']);
    }
    await database.query('DELETE FROM owners_timeline WHERE token_id = ANY($1::integer[])',[[...tokenIds]]);
    await insert(database,'owners_timeline',['token_id','arrival_tx','arrival_log_index','owner_address','arrived_at','departure_tx','departure_log_index','departed_at'],owners.map(owner=>[owner.tokenId,owner.arrival.tx,owner.arrival.logIndex,owner.owner,owner.arrivedAt,owner.departure?.tx??null,owner.departure?.logIndex??null,owner.departedAt]),['token_id','arrival_tx','arrival_log_index']);
    await database.query("INSERT INTO indexer_progress(stream,last_block,updated_at) VALUES ('chog-history',$1,$2) ON CONFLICT(stream) DO UPDATE SET last_block=EXCLUDED.last_block,updated_at=EXCLUDED.updated_at",[highestBlock,generatedAt]);
    await database.exec('COMMIT');
    return { snapshotHash, blocks:input.blocks.length, transactions:input.transactions.length, tokens:metadata.size, transfers:events.length, sales:sales.length, unclassified:events.filter(event=>event.class==='UNCLASSIFIED').length, paymentWindows:windows.size,escrowDeposits:events.filter(event=>event.class==='ESCROW_DEPOSIT').length,escrowCollections:events.filter(event=>event.class==='ESCROW_COLLECTION').length,ownershipRecords:owners.length, lastEventBlock:highestBlock, sourceToBlockExclusive:input.toBlockExclusive };
  } catch(error) { await database.exec('ROLLBACK');throw error; }
}
