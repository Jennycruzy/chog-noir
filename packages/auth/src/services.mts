import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createPublicClient,http,parseAbi,type Address} from 'viem';
import {monad} from '../../chain/src/client.mts';
import {CHOG} from '../../core/src/chain.mts';
import {WalletAuth,AuthError} from './auth.mts';
import {HolderDirectory,type OwnerSnapshot} from './holders.mts';
import {DetectiveRoster,type MetadataRecord} from './roster.mts';
import {CareerStore} from '../../career/src/store.mts';
import {WitnessConnections} from './connections.mts';

export async function holderServices(options:{root:string;origin:string;rpcUrl?:string;now?:()=>number}){
 const now=options.now??Date.now;
 const client=createPublicClient({chain:monad,transport:http(options.rpcUrl??process.env.MONAD_OWNER_RPC_HTTP??'https://rpc2.monad.xyz',{timeout:30_000,retryCount:1})});
 if(await client.getChainId()!==143)throw new AuthError('AUTH_CHAIN_INVALID','Monad mainnet is required.',503);
 const metadata=new Map<number,MetadataRecord>();
 for(let start=1;start<=1969;start+=64)await Promise.all(Array.from({length:Math.min(64,1970-start)},async(_,offset)=>{
  const id=start+offset,record=JSON.parse(await readFile(join(options.root,'data/metadata',id+'.json'),'utf8')) as MetadataRecord;
  if(!record.metadata||typeof record.uri!=='string'||!Number.isFinite(Date.parse(record.fetchedAt)))throw new AuthError('HOLDER_METADATA_MISSING','A detective profile could not be checked.',503);
  metadata.set(id,record);
 }));
 const path=join(options.root,'runs/owners/snapshot.json');let version='',snapshot:OwnerSnapshot|undefined;
 const loadSnapshot=async()=>{
  const info=await stat(path),next=info.ino+':'+info.mtimeMs+':'+info.size;
  if(!snapshot||next!==version){snapshot=JSON.parse(await readFile(path,'utf8')) as OwnerSnapshot;version=next;}
  return snapshot;
 };
 const holders=new HolderDirectory({now,snapshot:loadSnapshot,ownerOf:tokenId=>client.readContract({address:CHOG as Address,abi:parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']),functionName:'ownerOf',args:[BigInt(tokenId)]})});
 const career=new CareerStore(options.root),roster=new DetectiveRoster({holders,career,metadata,now});
 const auth=new WalletAuth({root:options.root,origin:options.origin,now,verify:request=>client.verifyMessage(request)});
 let links:{snapshot:OwnerSnapshot;atBlock:number;value:WitnessConnections}|undefined;
 const connectionsAt=async(atBlock:number)=>{
  const history=await loadSnapshot();
  if(!links||links.snapshot!==history||links.atBlock!==atBlock)links={snapshot:history,atBlock,value:new WitnessConnections({snapshot:history,metadata,atBlock})};
  return links.value;
 };
 return {auth,holders,career,roster,metadata,connectionsAt};
}
