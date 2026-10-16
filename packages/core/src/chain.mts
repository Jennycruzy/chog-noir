import type {EscrowProof} from './escrow.mts';
import { parseAbi, toEventSelector } from 'viem';
export const CHOG = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
export const SEAPORT = '0x0000000000000068f116a894984e2db1123eb395';
export const CHOG_TOKEN = '0x350035555e10d9afaf1566aaebfced5ba6c27777';
export const WMON = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
export const ZERO = '0x0000000000000000000000000000000000000000';
export const ESCROW = '0x0c13d51f3d52bb74e4eb131a2ed6978a99a417cf';
export const BULK = '0x0000000000c2d145a2526bd8c716263bfebe1a72';
export const DELEGATION = '0xdb9b1e94b5b69df7e401ddbede43491141047db3';
export const ROUTERS = new Set(['0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f', '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be']);
export const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
export const orderAbi = parseAbi(['event OrderFulfilled(bytes32 orderHash,address indexed offerer,address indexed zone,address recipient,(uint8 itemType,address token,uint256 identifier,uint256 amount)[] offer,(uint8 itemType,address token,uint256 identifier,uint256 amount,address recipient)[] consideration)']);
export const ORDER_TOPIC = toEventSelector(orderAbi[0]);
export interface ChainLog { address: string; topics: readonly string[]; data: string; transactionHash: string; blockNumber: number; logIndex: number; removed?: boolean }
export interface ChainTransaction { hash: string; from: string; to: string | null; input: string; blockNumber: number }
export interface Transfer { tx: string; block: number; logIndex: number; tokenId: number; from: string; to: string }
export type EventClass = 'MINT' | 'BURN' | 'SALE' | 'SEAPORT_NO_PAYMENT' | 'BULK_MOVE' | 'SMART_WALLET_ACTION' | 'PLAIN_TRANSFER' | 'ROUTER_MOVE' | 'UNCLASSIFIED' | 'ESCROW_DEPOSIT' | 'ESCROW_COLLECTION';
export interface Price { asset: 'MON' | 'WMON'; status: 'EXACT' | 'PRICE_BUNDLE'; grossWei: string | null; sellerProceedsWei: string | null; feesWei: string | null }
export interface Classification extends Transfer { class: EventClass; rule: string; reason: string; evidence: { tx: string; transferLogIndex: number; orderLogIndices: number[] }; route?: 'offer_accepted' | 'listing_bought'; price?: Price; escrow?: EscrowProof }
export function decodeTransfer(log: ChainLog): Transfer {
  if (log.removed || log.address.toLowerCase() !== CHOG || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length !== 4 || !/^0x[0-9a-f]{64}$/i.test(log.transactionHash) || !Number.isSafeInteger(log.blockNumber) || log.blockNumber < 0 || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || log.data !== '0x') throw new Error('DATA_TRANSFER: Invalid Chog transfer');
  const [from, to, id] = log.topics.slice(1);
  if (!from || !to || !id || ![from,to,id].every(value => /^0x[0-9a-f]{64}$/i.test(value)) || ![from,to].every(value => /^0x0{24}/i.test(value))) throw new Error('DATA_TRANSFER: Invalid transfer topics');
  const tokenId = Number(BigInt(id));
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 1969) throw new Error('DATA_TRANSFER: Unexpected token id');
  return { tx: log.transactionHash.toLowerCase(), block: log.blockNumber, logIndex: log.logIndex, tokenId, from: `0x${from.slice(-40)}`.toLowerCase(), to: `0x${to.slice(-40)}`.toLowerCase() };
}
