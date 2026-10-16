import type { Address, Hex } from 'viem';

export interface TokenMapping { uri: string; file: number; fetchedAt: string }
export interface Metadata { name: string; image: string; attributes: Array<{ trait_type: string; value: string }> }
export interface StoredMetadata { fetchedAt: string; uri: string; metadata: Metadata }
export interface RpcReply<T = unknown> { id: number; result?: T | null; error?: { code: number; message: string } }
export interface RpcTransaction { hash: Hex; from: Address; to: Address | null; input: Hex; value: Hex; blockHash: Hex; blockNumber: Hex }
export interface RpcLog { address: Address; topics: Hex[]; data: Hex; transactionHash: Hex; blockHash: Hex; blockNumber: Hex; logIndex: Hex; removed: boolean }
export interface RpcReceipt { transactionHash: Hex; blockHash: Hex; blockNumber: Hex; status: Hex; logs: RpcLog[] }
export interface StoredFixture { fetchedAt: string; replies: Array<RpcReply<RpcTransaction | RpcReceipt>> }
export interface HistoryBlock { number: number; timestamp: number; hash: Hex }
export interface HistoryLog { address: Address; topics: Hex[]; data: Hex; transactionHash: Hex; blockNumber: number; logIndex: number }
export interface HistoryTransaction { hash: Hex; from: Address; to: Address | null; input: Hex; value: string; blockNumber: number }
export interface StoredHistory { startedAt: string; finishedAt: string; toBlockExclusive: number; data: { blocks: HistoryBlock[]; transactions: HistoryTransaction[]; logs: HistoryLog[] } }
export interface PaymentCandidate { tx: Hex; tokenId: string; logIndex: number; block: number; selector: string | undefined; sellerAmountsWei: string[] }
export interface HistoryInspection { candidates: PaymentCandidate[]; unusual: PaymentCandidate[] }
export interface OpenSeaStats { total: { sales: number; num_owners: number; floor_price: number; floor_price_symbol: string } }
export interface StoredOpenSeaStats { fetchedAt: string; path: string; status: number; body: string }
export interface SaleEvent { event_type: string; event_timestamp: number; transaction: Hex; chain: string; nft: { identifier: string; contract: Address } }
export interface StoredSales { fetchedAt: string; pages: number; events: SaleEvent[] }
export interface SeaportItem { itemType: number; token: Address; identifier: bigint; amount: bigint }
export interface SeaportReceivedItem extends SeaportItem { recipient: Address }
export interface SeaportOrder { offerer: Address; zone: Address; orderHash: Hex; recipient: Address; offer: readonly SeaportItem[]; consideration: readonly SeaportReceivedItem[] }

export function required<T>(value: T | null | undefined, reason: string): T {
  if (value === undefined || value === null) throw new Error(reason);
  return value;
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function hasErrorCode(error: unknown, code: string): boolean { return error instanceof Error && 'code' in error && error.code === code; }
export function asHex(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value)) throw new Error('DATA_HEX: Invalid hexadecimal data');
  return value as Hex;
}
export function eventTopics(values: ReadonlyArray<string | null | undefined>): [Hex, ...Hex[]] {
  const topics = [...values];
  while (topics.length && topics[topics.length - 1] == null) topics.pop();
  if (!topics.length || topics.some(value => typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))) throw new Error('DATA_TOPIC: Missing or invalid event topic');
  return topics as [Hex, ...Hex[]];
}
