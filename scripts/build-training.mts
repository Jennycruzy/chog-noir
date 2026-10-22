import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {keccak256,toBytes} from 'viem';
import type {EnrichedEvent} from '../packages/core/src/enrich.mts';
import type {Metadata} from '../packages/cases/src/build.mts';
import {saleCandidates,type CaseRules} from '../packages/cases/src/select.mts';
import {buildSalePuzzle,planFor,PuzzleError} from '../packages/cases/src/puzzle.mts';
import {trainingFromPuzzle,TrainingError} from '../packages/game/src/training.mts';
import {atomicJSON} from '../packages/publishing/src/vault.mts';

// Builds Case #0 and the front-door REPLAY from one real archived sale. Both are labelled as replays and count for nothing.
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async(path:string)=>JSON.parse(await readFile(join(root,path),'utf8'));
const [enriched,history,rules]=await Promise.all([read('runs/daily/source/enriched.json'),read('runs/daily/source/history.json'),read('config/cases.json')]) as [{events:EnrichedEvent[]},{data:{blocks:{number:number;timestamp:number}[]}},CaseRules];
const times=new Map(history.data.blocks.map(row=>[row.number,row.timestamp])),metadata=new Map<number,Metadata>();
for(let start=1;start<=1969;start+=64)await Promise.all(Array.from({length:Math.min(64,1970-start)},async(_,offset)=>{const id=start+offset;metadata.set(id,(await read(`data/metadata/${id}.json`)).metadata);}));
const latest=Math.max(...times.values());
// Older than a week, so the replay never previews a live or upcoming case; a fixed order keeps it stable between runs.
const pool=saleCandidates(enriched.events,times,rules).filter(row=>row.at<latest-7*86400).sort((a,b)=>keccak256(toBytes('training:'+a.id)).localeCompare(keccak256(toBytes('training:'+b.id))));
for(const candidate of pool){
 const next=new Date((Math.floor(candidate.at/86400)+1)*86400000);
 // A weekday replay: one lying witness, which is what the training rule line promises.
 while([0,6].includes(next.getUTCDay()))next.setUTCDate(next.getUTCDate()+1);
 try{
  const puzzle=buildSalePuzzle({candidate,history:enriched.events,times,metadata,day:next.toISOString().slice(0,10),salt:keccak256(toBytes('replay:'+candidate.id)),mode:'REPLAY'});
  const training=trainingFromPuzzle(puzzle),lie=planFor(puzzle,null).lies.find(row=>row.id==='A')!,receipt=puzzle.file.receipts.find(row=>row.id===lie.receiptId)!;
  const witness=puzzle.file.cast.find(row=>row.tokenId===lie.witness)!,statement=planFor(puzzle,null).statements.find(row=>row.id===lie.statementId)!;
  const replay={label:'REPLAY',caseLine:`A real sale of ${puzzle.file.subject.name}, replayed.`,witness:{tokenId:witness.tokenId,name:witness.name},statement:statement.line,receipt:{text:receipt.text,sources:receipt.sources},inference:lie.inference,sourceCase:puzzle.file.id};
  await mkdir(join(root,'runs/training'),{recursive:true,mode:0o700});await mkdir(join(root,'runs/replay'),{recursive:true,mode:0o700});
  await atomicJSON(join(root,'runs/training/case.json'),training);await atomicJSON(join(root,'runs/replay/replay.json'),replay);
  console.log(JSON.stringify({status:'BUILT',training:training.id,subject:puzzle.file.subject.name,event:candidate.id}));process.exit(0);
 }catch(error){if(!(error instanceof PuzzleError||error instanceof TrainingError))throw error;}
}
throw new Error('TRAINING_UNAVAILABLE: No archived sale produced a training case');
