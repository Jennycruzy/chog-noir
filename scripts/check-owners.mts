import { required, type StoredHistory } from './data-types.mts';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const history = JSON.parse(await readFile(new URL('../data/related/history.json', import.meta.url), 'utf8')) as StoredHistory;
const nft = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const zero = '0x' + '0'.repeat(40);
const transfers = new Map(history.data.logs.filter(log => log.address.toLowerCase() === nft && log.topics[0] === topic).map(log => [`${log.transactionHash}:${log.logIndex}`, log]));
const ordered = [...transfers.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
const owners = new Map();
for (const log of ordered) {
  if (log.topics.length !== 4) throw new Error('DATA_OWNER: Incomplete transfer');
  const tokenId = Number(BigInt(required(log.topics[3], 'DATA_OWNER: Missing token topic')));
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 1969) throw new Error('DATA_OWNER: Unexpected token id');
  const from = '0x' + required(log.topics[1], 'DATA_OWNER: Missing sender topic').slice(-40).toLowerCase();
  const to = '0x' + required(log.topics[2], 'DATA_OWNER: Missing receiver topic').slice(-40).toLowerCase();
  if (from === zero && owners.has(tokenId)) throw new Error(`DATA_OWNER: Duplicate mint for ${tokenId}`);
  if (from !== zero && owners.get(tokenId)?.address !== from) throw new Error(`DATA_OWNER: Broken ownership history for ${tokenId} at ${log.transactionHash}:${log.logIndex}`);
  owners.set(tokenId, { tokenId, address: to, src: { tx: log.transactionHash, block: log.blockNumber, logIndex: log.logIndex } });
}
if (owners.size !== 1969) throw new Error('DATA_OWNER: Minted tokens are missing');
const wallets = [...new Set([...owners.values()].filter(owner => owner.address !== zero).map(owner => owner.address))];
const result = { generatedAt: new Date().toISOString(), toBlockExclusive: history.toBlockExclusive, transferCount: ordered.length, tokenCount: owners.size, walletCount: wallets.length, wallets, owners: [...owners.values()] };
const root = new URL('../data/owners/', import.meta.url);
await mkdir(root, { recursive: true });
await writeFile(new URL('snapshot.json', root), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ transferCount: ordered.length, tokens: owners.size, wallets: wallets.length, toBlockExclusive: result.toBlockExclusive }));
