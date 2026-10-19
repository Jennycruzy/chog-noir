import {parseAbi,keccak256,toBytes,toHex,type Hex,type Address} from 'viem';
import {canonicalJSON,type CaseDraft} from '../../cases/src/build.mts';
export const casebookAbi=parseAbi([
 'function owner() view returns (address)',
 'function openCase(bytes32 caseId,bytes32 answerHash,uint64 opensAt,uint64 closesAt)',
 'function closeCase(bytes32 caseId,bytes answerKeyCanonical)',
 'function recordCast(bytes32 caseId,uint256[] tokenIds,uint8[] flags)',
 'function caseOf(bytes32 caseId) view returns (bytes32 answerHash,bool closed)',
 'function caseTimes(bytes32 caseId) view returns (uint64 opensAt,uint64 closesAt)',
 'event CaseOpened(bytes32 indexed caseId,bytes32 answerHash,uint64 opensAt,uint64 closesAt)',
 'event CaseClosed(bytes32 indexed caseId,bytes answerKey)',
 'event CastRecorded(bytes32 indexed caseId,uint256 indexed tokenId,uint8 flags)',
]);
export const chainCaseId=(id:string)=>keccak256(toBytes(id));
export const canonicalKey=(draft:CaseDraft)=>canonicalJSON({v:1,caseId:draft.public.id,key:draft.private.key,salt:draft.private.salt});
export const encodedKey=(draft:CaseDraft)=>toHex(toBytes(canonicalKey(draft)));
export interface ChainReceipt {hash:Hex;blockNumber:string;blockHash:Hex;timestamp:number;status:'success';chainId:143;address:Address}
export interface CaseChain {
 address:Address;
 inspect(id:string):Promise<{hash:Hex;closed:boolean;opensAt:number;closesAt:number}>;
 open(draft:CaseDraft,opensAt:number,closesAt:number):Promise<ChainReceipt>;
 close(draft:CaseDraft):Promise<ChainReceipt>;
 cast(draft:CaseDraft):Promise<ChainReceipt>;
}
