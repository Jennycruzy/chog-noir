import type {EscrowIndex} from './escrow.mts';
import { decodeEventLog, type Hex } from 'viem';
import { CHOG, SEAPORT, WMON, ZERO, ESCROW, BULK, DELEGATION, ROUTERS, TRANSFER_TOPIC, ORDER_TOPIC, orderAbi, decodeTransfer, type ChainLog, type ChainTransaction, type Classification, type Price } from './chain.mts';

interface Item { itemType: number; token: string; identifier: bigint; amount: bigint }
function currency(item: Item): 'MON' | 'WMON' | undefined {
  if (item.identifier !== 0n) return;
  if (item.itemType === 0 && item.token.toLowerCase() === ZERO) return 'MON';
  if (item.itemType === 1 && item.token.toLowerCase() === WMON) return 'WMON';
}
function isNft(item: Item): boolean { return item.itemType >= 2; }

export function classifyTransaction(tx: ChainTransaction, logs: readonly ChainLog[], escrow?:EscrowIndex): Classification[] {
  if (!/^0x[0-9a-f]{64}$/i.test(tx.hash) || !/^0x[0-9a-f]{40}$/i.test(tx.from) || (tx.to !== null && !/^0x[0-9a-f]{40}$/i.test(tx.to)) || !/^0x(?:[0-9a-f]{2})*$/i.test(tx.input) || !Number.isSafeInteger(tx.blockNumber) || tx.blockNumber < 0) throw new Error('DATA_TRANSACTION: Invalid transaction');
  const seen = new Set<number>();
  for (const log of logs) {
    if (log.transactionHash.toLowerCase() !== tx.hash.toLowerCase() || log.blockNumber !== tx.blockNumber || log.removed || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || seen.has(log.logIndex)) throw new Error('DATA_LOG_SOURCE: Missing, duplicate or mismatched transaction log');
    seen.add(log.logIndex);
  }
  const orderedLogs = [...logs].sort((a,b) => a.logIndex-b.logIndex);
  const transfers = orderedLogs.filter(log => log.address.toLowerCase() === CHOG && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC).map(decodeTransfer);
  const orders = orderedLogs.filter(log => log.address.toLowerCase() === SEAPORT && log.topics[0]?.toLowerCase() === ORDER_TOPIC).map(log => {
    const decoded = decodeEventLog({ abi: orderAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data as Hex, strict: true });
    return { ...decoded.args, logIndex: log.logIndex };
  });
  return transfers.map(transfer => {
    const matchingItem = (item: Item) => item.token.toLowerCase() === CHOG && item.identifier === BigInt(transfer.tokenId) && item.itemType === 2 && item.amount === 1n;
    const matched = orders.filter(order => [...order.offer, ...order.consideration].some(matchingItem));
    const evidence = { tx: transfer.tx, transferLogIndex: transfer.logIndex, orderLogIndices: matched.map(order => order.logIndex) };
    const result = (cls: Classification['class'], rule: string, reason: string): Classification => ({ ...transfer, class: cls, rule, reason, evidence });
    const unknown = (reason: string) => result('UNCLASSIFIED', 'R8', reason);
    if (transfer.from === ZERO) return result('MINT', 'R1', 'Transfer from the zero address');
    if (transfer.to === ZERO) return result('BURN', 'BURN', 'Transfer to the zero address');
    if (transfer.from === ESCROW || transfer.to === ESCROW) {
      const proof=escrow?.resolve(transfer);
      if(!proof) return unknown('CLASS_ESCROW: Escrow payment and collection require separate deal evidence');
      return {...result(proof.role==='deposit'?'ESCROW_DEPOSIT':'ESCROW_COLLECTION','ESCROW',proof.role==='deposit'?'NFT deposited into escrow; seller payment recorded':'Buyer collected NFT from escrow; no second sale counted'),escrow:proof};
    }
    if (matched.length) {
      if (transfers.filter(item => item.tokenId === transfer.tokenId).length !== 1 || transfer.from === transfer.to) return unknown('CLASS_COMPLEX: Repeated token movement in one transaction');
      if (matched.some(order => order.offer.some(matchingItem) && order.consideration.some(matchingItem))) return unknown('CLASS_COMPLEX: Same NFT on both sides of a fulfilled order');
      const bids = matched.filter(order => order.consideration.some(matchingItem));
      const listings = matched.filter(order => order.offer.some(matchingItem));
      if (bids.length > 1 || listings.length > 1) return unknown('CLASS_COMPLEX: Multiple competing orders for the token');
      const bid = bids[0];
      const listing = listings[0];
      const order = bid ?? listing;
      if (!order) return unknown('CLASS_ORDER: No supported fulfilled order');
      const route = bid ? 'offer_accepted' : 'listing_bought';
      if (bid && (bid.recipient.toLowerCase() !== transfer.from || bid.offerer.toLowerCase() !== transfer.to || bid.consideration.find(matchingItem)?.recipient.toLowerCase() !== transfer.to)) return unknown('CLASS_PARTIES: Bid does not match NFT sender and receiver');
      if (listing && listing.offerer.toLowerCase() !== transfer.from) return unknown('CLASS_PARTIES: Listing does not match NFT sender');
      if (!bid && listing?.recipient.toLowerCase() !== transfer.to) return unknown('CLASS_PARTIES: Listing recipient does not match NFT receiver');
      if (!bid && order.offer.some(item => !isNft(item))) return unknown('CLASS_ORDER: Listing includes non-NFT offered items');
      const money = bid ? bid.offer : order.consideration;
      if (!money.length) return result('SEAPORT_NO_PAYMENT', 'R3', 'Fulfilled order has no monetary items');
      if (money.some(item => !currency(item) || item.amount <= 0n)) return unknown('PRICE_ASSET: Unsupported or mixed order items');
      const asset = currency(money[0]!);
      if (!asset || money.some(item => currency(item) !== asset)) return unknown('PRICE_ASSET: More than one payment asset');
      const nftItems = (bid ? order.consideration : order.offer).filter(isNft);
      if (nftItems.some(item => item.itemType !== 2 || item.amount !== 1n)) return unknown('CLASS_ORDER: Unsupported NFT item');
      const feeItems = order.consideration.filter(item => item.itemType <= 1);
      if (feeItems.some(item => currency(item) !== asset || item.amount < 0n)) return unknown('PRICE_ASSET: Unsupported consideration asset');
      const total = money.reduce((sum, item) => sum + item.amount, 0n);
      let seller = bid ? total - feeItems.filter(item => item.recipient.toLowerCase() !== transfer.from).reduce((sum, item) => sum + item.amount, 0n)
        : order.consideration.filter(item => item.recipient.toLowerCase() === transfer.from && currency(item) === asset).reduce((sum, item) => sum + item.amount, 0n);
      if (seller <= 0n || seller > total) return unknown('PRICE_ALLOCATION: Seller payment cannot be established');
      if (bid && listing) {
        if (listing.offer.some(item => !isNft(item)) || listing.consideration.some(item => currency(item) !== asset || item.amount < 0n) || listing.consideration.reduce((sum,item) => sum + item.amount,0n) !== seller) return unknown('PRICE_ALLOCATION: Matched orders disagree on payment allocation');
        seller = listing.consideration.filter(item => item.recipient.toLowerCase() === transfer.from).reduce((sum,item) => sum + item.amount,0n);
        if (seller <= 0n) return unknown('PRICE_ALLOCATION: Matched seller proceeds are missing');
      }
      const price: Price = nftItems.length === 1 ? { asset, status: 'EXACT', grossWei: total.toString(), sellerProceedsWei: seller.toString(), feesWei: (total-seller).toString() }
        : { asset, status: 'PRICE_BUNDLE', grossWei: null, sellerProceedsWei: null, feesWei: null };
      return { ...result('SALE', 'R2', price.status === 'EXACT' ? 'NFT and payment items match the transfer' : 'Paid bundle; no individual token price'), route, price };
    }
    if (tx.to?.toLowerCase() === SEAPORT) return unknown('CLASS_ORDER: Seaport call lacks a matching fulfilled order');
    if (tx.to?.toLowerCase() === BULK) return result('BULK_MOVE', 'R4', 'Known bulk-transfer helper; no matched sale evidence');
    if (tx.to?.toLowerCase() === DELEGATION) return result('SMART_WALLET_ACTION', 'R5', 'Delegation action; no matched sale evidence');
    if (tx.to?.toLowerCase() === CHOG && tx.from.toLowerCase() === transfer.from) return result('PLAIN_TRANSFER', 'R6', 'Owner signed a direct NFT transfer; intent is not inferred');
    if (tx.to && ROUTERS.has(tx.to.toLowerCase())) return result('ROUTER_MOVE', 'R7', 'Known router; no matched sale evidence');
    return unknown('CLASS_UNKNOWN: No verified classification rule matches');
  });
}
