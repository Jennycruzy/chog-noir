import { required, eventTopics, type StoredFixture, type RpcTransaction, type RpcReceipt } from './data-types.mts';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseAbi, decodeEventLog, formatEther } from 'viem';

const abi = parseAbi(['event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, (uint8 itemType, address token, uint256 identifier, uint256 amount)[] offer, (uint8 itemType, address token, uint256 identifier, uint256 amount, address recipient)[] consideration)']);
const seaport = '0x0000000000000068f116a894984e2db1123eb395';
const directory = new URL('../packages/core/test/fixtures/', import.meta.url);
const results = [];
for (const file of (await readdir(directory)).filter(file => file.endsWith('.json'))) {
  const stored = JSON.parse(await readFile(new URL(file, directory), 'utf8')) as StoredFixture;
  const transaction = required(stored.replies.find(reply => reply.id === 0)?.result, 'DATA_FIXTURE: Transaction missing') as RpcTransaction;
  const receipt = required(stored.replies.find(reply => reply.id === 1)?.result, 'DATA_FIXTURE: Receipt missing') as RpcReceipt;
  if (transaction.to?.toLowerCase() !== seaport) continue;
  const orders = [];
  for (const log of receipt.logs.filter(log => log.address.toLowerCase() === seaport)) {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: eventTopics(log.topics) });
      orders.push({ logIndex: log.logIndex, ...decoded.args });
    } catch (error) {
      if (log.topics[0]?.startsWith('0x9d9af8e3')) throw error;
    }
  }
  const result = { tx: transaction.hash, selector: transaction.input.slice(0, 10), orders };
  results.push(result);
  const money = orders.flatMap(order => [...order.offer, ...order.consideration]).filter(item => item.itemType <= 1);
  console.log(JSON.stringify({ tx: result.tx, selector: result.selector, orderEvents: orders.length, monetaryItems: money.map(item => ({ asset: item.token, amount: formatEther(item.amount) })) }));
}
const root = new URL('../runs/checks/', import.meta.url);
await mkdir(root, { recursive: true });
await writeFile(new URL('payment-events.json', root), JSON.stringify({ inspectedAt: new Date().toISOString(), results }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
