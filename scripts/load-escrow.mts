import {readFile,readdir} from 'node:fs/promises';
import {type EscrowInput} from '../packages/core/src/escrow.mts';
import {eventTopics} from './data-types.mts';
export async function loadEscrow(toBlockExclusive:number):Promise<EscrowInput> {
  const directory=new URL('../data/contract-check/',import.meta.url);
  const files=(await readdir(directory)).filter(file=>/^contract-page-\d+\.json$/.test(file)).sort((a,b)=>Number(a.match(/\d+/)?.[0])-Number(b.match(/\d+/)?.[0]));
  if(!files.length) throw new Error('DATA_ESCROW_SOURCE: Run data:escrow to save the original replies');
  const input:EscrowInput={fromBlock:0,toBlockExclusive,logs:[],sources:{}};
  let nextBlock=0;
  for(const file of files) {
    const page=JSON.parse(await readFile(new URL(file,directory),'utf8')) as {fetchedAt:string;query:{fromBlock:number;toBlock:number};reply:{nextBlock:number;data:{logs:Array<Omit<EscrowInput['logs'][number],'topics'>&{topics:(string|null)[]}>}}};
    if(page.query.fromBlock!==nextBlock||page.reply.nextBlock<=nextBlock) throw new Error('DATA_ESCROW_COVERAGE: Missing or overlapping source page');
    nextBlock=page.reply.nextBlock;
    for(const raw of page.reply.data.logs) {
      if(raw.blockNumber>=toBlockExclusive) continue;
      const log={...raw,topics:eventTopics(raw.topics)};
      input.logs.push(log);
      input.sources[`${log.transactionHash.toLowerCase()}:${log.logIndex}`]={fetchedAt:page.fetchedAt,request:page.query};
    }
  }
  if(nextBlock<toBlockExclusive) throw new Error('DATA_ESCROW_COVERAGE: Escrow source is older than the NFT snapshot');
  return input;
}
