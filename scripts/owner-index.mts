import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ownerIndexer} from '../packages/indexer/src/owners.mts';
import {rpcOwnerSource} from '../packages/indexer/src/owner-source.mts';
import type {OwnerSnapshot} from '../packages/auth/src/holders.mts';
import {loadEnv} from './env.mts';
import {safeError} from './errors.mts';

await loadEnv();
const args=process.argv.slice(2),seedFlag=args.indexOf('--seed');
if(args.some((arg,index)=>arg!=='--once'&&arg!=='--seed'&&!(seedFlag>=0&&index===seedFlag+1))||seedFlag>=0&&(!args[seedFlag+1]||args[seedFlag+1]!.startsWith('--'))||args.filter(arg=>arg==='--seed').length>1)throw new Error('OWNER_INPUT: Use --once and optional --seed path');
const root=fileURLToPath(new URL('../',import.meta.url));
const seed:OwnerSnapshot|undefined=seedFlag<0?undefined:JSON.parse(await readFile(resolve(args[seedFlag+1]!),'utf8'));
const indexer=ownerIndexer({root,source:rpcOwnerSource(process.env.MONAD_OWNER_RPC_HTTP??'https://rpc2.monad.xyz')});
let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
do{
 const cycleStarted=Date.now();
 try{const snapshot=await indexer.refresh(seed);console.log(JSON.stringify({kind:'owner_index',indexedBlock:snapshot.indexedBlock,indexedAt:snapshot.indexedAt,checkedAt:snapshot.checkedAt,transfers:snapshot.transfers.length,cycleMs:Date.now()-cycleStarted}));}
 catch(error){console.error('OWNER_REFRESH_FAILED',safeError(error),JSON.stringify({cycleMs:Date.now()-cycleStarted}));if(args.includes('--once'))process.exitCode=1;}
 if(args.includes('--once')||stopped)break;
 const delay=Math.max(0,15_000-(Date.now()-cycleStarted));
 await new Promise<void>(done=>{const finish=()=>{clearTimeout(timer);process.off('SIGTERM',finish);process.off('SIGINT',finish);done();};const timer=setTimeout(finish,delay);process.once('SIGTERM',finish);process.once('SIGINT',finish);});
}while(!stopped);
