import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { type StoredHistory } from './data-types.mts';
import { historySources } from './history-sources.mts';
const sources=await historySources(new URL('../data/related/',import.meta.url));
const history = JSON.parse(await readFile(new URL('../data/related/history.json',import.meta.url),'utf8')) as StoredHistory;
const hash = '0xa0f9c62a8fbe0772052bc7c03ce3c39f84315c960348381f7ad55ef05376f445';
const transaction = history.data.transactions.find(tx=>tx.hash===hash);
if (!transaction) throw new Error('DATA_FIXTURE: Matched fee transaction missing');
const fixture={ fetchedAt:history.finishedAt, transaction, logs:history.data.logs.filter(log=>log.transactionHash===hash) };
const output=new URL('../packages/core/test/history/',import.meta.url);
await mkdir(output,{recursive:true});
await writeFile(new URL('matched-fees.json',output),JSON.stringify(fixture,null,2)+'\n');
console.log('Saved original matched-order records from the downloaded public history.');

const tokenLogs=history.data.logs.filter(log=>log.address.toLowerCase()==='0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763'&&log.topics[0]==='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'&&log.topics[3]&&BigInt(log.topics[3])===650n);
const hashes=new Set(tokenLogs.map(log=>log.transactionHash));
const numbers=new Set(tokenLogs.map(log=>log.blockNumber));
await writeFile(new URL('token-650.json',output),JSON.stringify({fetchedAt:history.finishedAt,toBlockExclusive:history.toBlockExclusive,sources:{transactions:Object.fromEntries([...hashes].map(hash=>[hash,sources.transactions[hash]])),blocks:Object.fromEntries([...numbers].map(number=>[number,sources.blocks[number]]))},logs:tokenLogs,relatedLogs:history.data.logs.filter(log=>hashes.has(log.transactionHash)),transactions:history.data.transactions.filter(tx=>hashes.has(tx.hash)),blocks:history.data.blocks.filter(block=>numbers.has(block.number))},null,2)+'\n');

const selfLogs=history.data.logs.filter(log=>log.address.toLowerCase()==='0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763'&&log.topics[0]==='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'&&log.topics[3]&&BigInt(log.topics[3])===1217n);
const selfNumbers=new Set(selfLogs.map(log=>log.blockNumber));
const selfHashes=new Set(selfLogs.map(log=>log.transactionHash));
await writeFile(new URL('token-1217.json',output),JSON.stringify({fetchedAt:history.finishedAt,logs:selfLogs,blocks:history.data.blocks.filter(block=>selfNumbers.has(block.number)),transactions:history.data.transactions.filter(tx=>selfHashes.has(tx.hash))},null,2)+'\n');
