import { required, eventTopics, type StoredFixture, type RpcTransaction, type RpcReceipt } from '../../../scripts/data-types.mts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeEventLog } from 'viem';
import { seaportEventAbi } from '../../../scripts/seaport-event.mts';

const seaport = '0x0000000000000068f116a894984e2db1123eb395';
const nft = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
async function fixture(hash: string) {
  const record = JSON.parse(await readFile(new URL(`fixtures/${hash}.json`, import.meta.url), 'utf8')) as StoredFixture;
  const tx = required(record.replies.find(reply => reply.id === 0)?.result, 'DATA_FIXTURE: Transaction missing') as RpcTransaction;
  const receipt = required(record.replies.find(reply => reply.id === 1)?.result, 'DATA_FIXTURE: Receipt missing') as RpcReceipt;
  const orders = receipt.logs.filter(log => log.address.toLowerCase() === seaport && log.topics[0]?.startsWith('0x9d9af8e3')).map(log => decodeEventLog({ abi: seaportEventAbi, topics: eventTopics(log.topics), data: log.data }).args);
  return { tx, orders };
}
function offersNft(order: { offer: ReadonlyArray<{ token: string; identifier: bigint }> }, id: bigint) { return order.offer.some(item => item.token.toLowerCase() === nft && item.identifier === id); }

test('Offer accepted: payment and fee are distinct fulfilled items', async () => {
  const { orders } = await fixture('0x8d144408fae4b78a5d7a42efa85ddf0ec30be2de67e8c05cff2df4a6a5830e3c');
  assert.equal(orders.length, 2);
  const order = orders.find(order => offersNft(order, 1473n));
  assert.ok(order);
  const sellerPayment = order.consideration.find(item => item.itemType === 1);
  assert.equal(required(sellerPayment, 'Seller payment missing').amount, 4377780000000000000000n);
  const bid = orders.find(item => item.offer.some(offered => offered.itemType === 1));
  assert.equal(required(required(bid, 'Bid missing').offer[0], 'Offered item missing').amount, 4422000000000000000000n);
  assert.equal(required(required(bid, 'Bid missing').consideration.find(item => item.itemType === 1), 'Fee missing').amount, 44220000000000000000n);
});

test('Advanced order is an accepted offer: 4,900 WMON bid includes the 49 fee', async () => {
  const { tx, orders } = await fixture('0xdecaddd8a4f17fd6b57cbce9d504cd5b9feb86a64ffd6ef1e1f0632af077495f');
  assert.equal(orders.length, 1);
  assert.equal(tx.input.slice(0, 10), '0xe7acab24');
  assert.equal(offersNft(required(orders[0], 'Order missing'), 445n), false);
  assert.ok(required(orders[0], 'Order missing').consideration.some(item => item.token.toLowerCase() === nft && item.identifier === 445n));
  const offered = required(orders[0], 'Order missing').offer.find(item => item.itemType === 1);
  const fee = required(orders[0], 'Order missing').consideration.find(item => item.itemType === 1);
  assert.equal(required(offered, 'Offered payment missing').amount, 4900000000000000000000n);
  assert.equal(required(fee, 'Fee missing').amount, 49000000000000000000n);
  assert.equal(required(offered, 'Offered payment missing').amount - required(fee, 'Fee missing').amount, 4851000000000000000000n);
});

test('Native listing: 5,200 MON total is 5,148 proceeds plus 52 fee', async () => {
  const { tx, orders } = await fixture('0x89c8e99142bd0c0419d83b79c316c33996a25b497e35c0af7f5958eb33a9a134');
  assert.equal(orders.length, 1);
  assert.ok(offersNft(required(orders[0], 'Order missing'), 650n));
  assert.equal(BigInt(tx.value), 5200000000000000000000n);
  const payment = required(orders[0], 'Order missing').consideration.find(item => item.recipient.toLowerCase() === required(orders[0], 'Order missing').offerer.toLowerCase());
  assert.equal(required(payment, 'Payment missing').amount, 5148000000000000000000n);
});

test('Batch purchase: token 1864 uses its own order, never transaction value divided by four', async () => {
  const { tx, orders } = await fixture('0x0b9b19c489b4f816d0fb9d30029be8743d5cb9d7c870e596713a6cd796394049');
  assert.equal(orders.length, 4);
  const order = orders.find(order => offersNft(order, 1864n));
  assert.ok(order);
  const payment = order.consideration.find(item => item.recipient.toLowerCase() === order.offerer.toLowerCase());
  assert.equal(required(payment, 'Payment missing').amount, 6038999901000000000000n);
  const total = order.consideration.reduce((sum, item) => sum + item.amount, 0n);
  assert.equal(total, 6099999900000000000000n);
  assert.notEqual(total, BigInt(tx.value) / 4n);
});

test('Unusual 0.69 MON route: fulfilled order includes payment and the same NFT on both sides', async () => {
  const { tx, orders } = await fixture('0xb99816a46217e53c5da521b31ce721fd6f751e16cc12bcf3bcc301ab9f07d2bf');
  const order = orders.find(order => offersNft(order, 1864n));
  assert.ok(order);
  assert.ok(order.consideration.some(item => item.token.toLowerCase() === nft && item.identifier === 1864n));
  const payment = order.consideration.find(item => item.itemType === 0);
  assert.equal(required(payment, 'Payment missing').amount, 690000000000000000n);
  assert.equal(BigInt(tx.value), 690000000000000000n);
  assert.equal(tx.from.toLowerCase(), '0x4efca7cc8058d5acd2bb2ccd2a9430906291cdd6');
});
