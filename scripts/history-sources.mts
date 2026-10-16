import { readFile,readdir } from 'node:fs/promises';
import type { HistoryInput } from '../packages/database/import-history.mts';
export async function historySources(directory: URL): Promise<HistoryInput['sources']> {
  const sources:HistoryInput['sources']={transactions:{},blocks:{}};
  const files=(await readdir(directory)).filter(file=>/^page-\d+\.json$/.test(file)).sort((a,b)=>Number(a.match(/\d+/)?.[0])-Number(b.match(/\d+/)?.[0]));
  if(!files.length) throw new Error('DATA_SOURCE: Original API replies are missing');
  for(const file of files) {
    const page=JSON.parse(await readFile(new URL(file,directory),'utf8')) as {fetchedAt:string;query:unknown;reply:{data:{transactions:{hash:string}[];blocks:{number:number}[]}}};
    if(!Number.isFinite(Date.parse(page.fetchedAt))||!page.query) throw new Error('DATA_SOURCE: API fetch time or request missing');
    const source={fetchedAt:page.fetchedAt,request:page.query};
    for(const tx of page.reply.data.transactions) sources.transactions[tx.hash.toLowerCase()]??=source;
    for(const block of page.reply.data.blocks) sources.blocks[block.number]??=source;
  }
  return sources;
}
