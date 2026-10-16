import { required, type StoredFixture, type RpcTransaction, type RpcReceipt } from '../../../scripts/data-types.mts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const directory = new URL('./fixtures/', import.meta.url);
const files = (await readdir(directory)).filter(file => file.endsWith('.json'));
assert.equal(files.length, 12, 'All twelve real transactions must be available offline');
for (const file of files) {
  test(`Stored transaction and receipt agree: ${file.slice(0, -5)}`, async () => {
    const record = JSON.parse(await readFile(new URL(file, directory), 'utf8')) as StoredFixture;
    const tx = record.replies.find(reply => reply.id === 0)?.result as RpcTransaction | undefined;
    const receipt = record.replies.find(reply => reply.id === 1)?.result as RpcReceipt | undefined;
    assert.ok(tx && receipt);
    assert.equal(tx.hash, file.slice(0, -5));
    assert.equal(receipt.transactionHash, tx.hash);
    assert.equal(receipt.blockHash, tx.blockHash);
    assert.equal(receipt.blockNumber, tx.blockNumber);
    assert.equal(receipt.status, '0x1');
    assert.ok(Number.isFinite(Date.parse(record.fetchedAt)));
    const indexes = new Set();
    for (const log of receipt.logs) {
      assert.equal(log.transactionHash, tx.hash);
      assert.equal(log.blockHash, tx.blockHash);
      assert.equal(log.removed, false);
      assert.ok(!indexes.has(log.logIndex));
      indexes.add(log.logIndex);
    }
  });
}
