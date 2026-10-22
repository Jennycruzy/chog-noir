import {parseAbi,keccak256,toBytes,toHex,type Hex,type Address} from 'viem';
import {canonicalJSON} from '../../cases/src/build.mts';
import {planFor,type PuzzleCase} from '../../cases/src/puzzle.mts';
export const casebookAbi=parseAbi([
 'function owner() view returns (address)',
 'function openCase(bytes32 caseId,bytes32 answerHash,uint64 opensAt,uint64 closesAt)',
 'function closeCase(bytes32 caseId,bytes answerKeyCanonical)',
 'function recordCast(bytes32 caseId,uint256[] tokenIds,uint8[] flags)',
 'function recordSolves(bytes32 caseId,uint16[] tokenIds,uint8[] results)',
 'function solveRecorded(bytes32 caseId,uint16 tokenId) view returns (bool)',
 'function caseOf(bytes32 caseId) view returns (bytes32 answerHash,bool closed)',
 'function caseTimes(bytes32 caseId) view returns (uint64 opensAt,uint64 closesAt)',
 'event CaseOpened(bytes32 indexed caseId,bytes32 answerHash,uint64 opensAt,uint64 closesAt)',
 'event CaseClosed(bytes32 indexed caseId,bytes answerKey)',
 'event CastRecorded(bytes32 indexed caseId,uint256 indexed tokenId,uint8 flags)',
 'event SolveRecorded(bytes32 indexed caseId,uint16 indexed tokenId,uint8 result)',
]);
export const chainCaseId=(id:string)=>keccak256(toBytes(id));
/** The revealed v2 key is the exact canonical text whose hash was committed at open. */
export const puzzleKeyText=(puzzle:PuzzleCase)=>canonicalJSON(puzzle.key);
export const puzzleKeyBytes=(puzzle:PuzzleCase)=>toHex(toBytes(puzzleKeyText(puzzle)));
/** Cast flags: bit 0 in the cast, bit 1 subject, bit 2 liar in the shared plan. */
export function puzzleCastFlags(puzzle:PuzzleCase){
 const liars=new Set(planFor(puzzle,null).lies.map(row=>row.witness));
 return {tokenIds:puzzle.file.cast.map(row=>BigInt(row.tokenId)),flags:puzzle.file.cast.map(row=>1|(row.tokenId===puzzle.file.subject.tokenId?2:0)|(liars.has(row.tokenId)?4:0))};
}
export interface SolveRecord {tokenId:number;solved:boolean;perfect:boolean;caught:('A'|'B'|'C')[];grade:'A'|'B'|'C'|'D'}
/** Result bits: 0 solved, 1 perfect, 2-4 lies A/B/C, 5-6 grade (A=3 .. D=0). */
export function solveResult(row:SolveRecord){
 if(!Number.isSafeInteger(row.tokenId)||row.tokenId<1||row.tokenId>1969||!['A','B','C','D'].includes(row.grade)||row.caught.some(id=>!['A','B','C'].includes(id)))throw new Error('CHAIN_SOLVE_INVALID: Result is outside the CaseBook encoding');
 return (row.solved?1:0)|(row.perfect?2:0)|(row.caught.includes('A')?4:0)|(row.caught.includes('B')?8:0)|(row.caught.includes('C')?16:0)|({D:0,C:1,B:2,A:3}[row.grade]<<5);
}
export interface ChainReceipt {hash:Hex;blockNumber:string;blockHash:Hex;timestamp:number;status:'success';chainId:143;address:Address}
export interface PuzzleChain {
 address:Address;
 inspect(id:string):Promise<{hash:Hex;closed:boolean;opensAt:number;closesAt:number}>;
 open(puzzle:PuzzleCase):Promise<ChainReceipt>;
 close(puzzle:PuzzleCase):Promise<ChainReceipt>;
 cast(puzzle:PuzzleCase):Promise<ChainReceipt>;
 solves(puzzle:PuzzleCase,chunk:number,rows:readonly SolveRecord[]):Promise<ChainReceipt>;
}
