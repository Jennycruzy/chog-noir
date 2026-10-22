import {test,expect} from 'vitest';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WitnessVoice,reserveFor,acceptLine,LIFETIME_CAP_USD,type BatchClient,type VoiceRequest} from '../src/voice.mts';
import {witnessStatement} from '../src/lines.mts';

// A stand-in for the batch endpoint: nothing here reaches the network or spends money.
function standIn(reply:(fact:string,index:number)=>{text:string;stop?:string}){
 const sent:{custom_id:string;params:any}[][]=[];
 const client={
  async create(body:{requests:{custom_id:string;params:any}[]}){sent.push(body.requests);return {id:'msgbatch_'+sent.length,processing_status:'in_progress'};},
  async retrieve(id:string){return {id,processing_status:'ended'};},
  async results(id:string){const batch=sent[Number(id.split('_')[1])-1]!;return (async function*(){for(const [index,request] of batch.entries()){const fact=JSON.parse(request.params.messages[0].content).fact,out=reply(fact,index);
   yield {custom_id:request.custom_id,result:{type:'succeeded',message:{stop_reason:out.stop??'end_turn',content:[{type:'text',text:out.text}],usage:{input_tokens:300,output_tokens:40,cache_creation_input_tokens:0,cache_read_input_tokens:0}}}};}})();},
 } as unknown as BatchClient;
 return {client,sent};
}
const requests:VoiceRequest[]=['CHOG #368 was paid for with about 5,800 MON','CHOG #1381 reached its new wallet on Thu 1 Oct, 01:11 UTC'].map(fact=>({fact,purpose:'opening',voice:'cool',self:false,persona:'cool eyes, a gold tooth'}));
async function sandbox(action:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'chog-voice-'));try{await action(root);}finally{await rm(root,{recursive:true,force:true});}}

test('valid lines are cached and used, invalid or refused lines fall back to templates, and cost is booked',()=>sandbox(async root=>{
 const {client,sent}=standIn((fact,index)=>index===0?{text:JSON.stringify({line:`I watched it close, under the streetlight: ${fact}.`,facts_used:[fact]})}:{text:'',stop:'refusal'});
 const voice=new WitnessVoice({root,client});
 expect(await voice.submit('claude-haiku-5-5',requests)).toBe('msgbatch_1');
 expect(sent[0]![0]!.params.output_config.format.type).toBe('json_schema');expect(sent[0]![0]!.params.system[0].cache_control).toEqual({type:'ephemeral'});
 expect(await voice.collect()).toEqual({collected:1,accepted:1,rejected:1});
 expect(await voice.line('claude-haiku-5-5',requests[0]!,'s')).toBe(`I watched it close, under the streetlight: ${requests[0]!.fact}.`);
 expect(await voice.line('claude-haiku-5-5',requests[1]!,'s')).toBe(witnessStatement({...requests[1]!,seed:'s'}));
 const spend=await voice.spend();expect(spend.reservedUsd).toBe(0);expect(spend.spentUsd).toBeCloseTo(2*(300*0.05+40*0.25)/1e6,10);
 // The cached line is never paid for again.
 expect(await voice.submit('claude-haiku-5-5',[requests[0]!])).toBeNull();expect(sent).toHaveLength(1);
}));

test('a batch that could pass the lifetime cap or the Opus allowance is refused before anything is sent',()=>sandbox(async root=>{
 const {client,sent}=standIn(()=>({text:'{}'}));
 await mkdir(join(root,'runs/voice'),{recursive:true});
 await writeFile(join(root,'runs/voice/ledger.json'),JSON.stringify({v:1,spentUsd:LIFETIME_CAP_USD-reserveFor('claude-haiku-5-5',requests)/2,reservedUsd:0,opusUsd:0,batches:[]}));
 await expect(new WitnessVoice({root,client}).submit('claude-haiku-5-5',requests)).rejects.toMatchObject({code:'VOICE_BUDGET_EXCEEDED'});
 await writeFile(join(root,'runs/voice/ledger.json'),JSON.stringify({v:1,spentUsd:0,reservedUsd:0,opusUsd:1.9999,batches:[]}));
 await expect(new WitnessVoice({root,client}).submit('claude-opus-5-5',requests)).rejects.toMatchObject({code:'VOICE_BUDGET_EXCEEDED'});
 expect(sent).toHaveLength(0);
 await expect(new WitnessVoice({root,client:null}).submit('claude-haiku-5-5',requests)).rejects.toMatchObject({code:'VOICE_DISABLED'});
}));

test('a voiced line must carry the exact fact and nothing else',()=>{
 const request=requests[0]!;
 expect(acceptLine(request,{line:`I saw it plainly: ${request.fact}.`,facts_used:[request.fact]})).toEqual([]);
 expect(acceptLine(request,{line:`I saw it at 3 am: ${request.fact}.`,facts_used:[request.fact]})).toContain('EXTRA_VALUE');
 expect(acceptLine(request,{line:`As an AI I note: ${request.fact}.`,facts_used:[request.fact]})).toEqual(expect.arrayContaining(['SHAPE','OFF_VOICE']));
 expect(acceptLine(request,{line:'I saw about 5,000 MON change hands.',facts_used:[request.fact]})).toContain('MISSING_FACT');
 expect(acceptLine(request,{line:`I polish my gold tooth and say: ${request.fact}.`,facts_used:[request.fact]})).toContain('TRAIT_NAME');
});

test('voicing a case changes only its words: facts, receipts and solution stay, and the key is recommitted',async()=>{
 const {puzzle}=await import('../../../apps/api/test/fixture.mts'),{applyVoice,caseVoiceRequests}=await import('../src/voice.mts'),{puzzleHash,validatePuzzle}=await import('../../cases/src/puzzle.mts');
 const personas=new Map(puzzle.file.cast.map(row=>[row.tokenId,'a witness']));
 // Templates reproduce the original lines exactly, so an unvoiced case is unchanged.
 const same=await applyVoice(puzzle,personas,async(request,seed)=>witnessStatement({...request,seed}));
 expect(same.answerHash).toBe(puzzle.answerHash);
 const voiced=await applyVoice(puzzle,personas,async request=>`I keep this between us: ${request.fact}.`);
 expect(validatePuzzle(voiced)).toEqual([]);expect(voiced.answerHash).toBe(puzzleHash(voiced));expect(voiced.answerHash).not.toBe(puzzle.answerHash);
 expect(voiced.file).toEqual(puzzle.file);expect(voiced.key.answers).toEqual(puzzle.key.answers);
 for(const [id,plan] of Object.entries(voiced.key.plans))expect(plan.lies.map(row=>[row.kind,row.trueValue,row.falseValue,row.receiptId])).toEqual(puzzle.key.plans[id]!.lies.map(row=>[row.kind,row.trueValue,row.falseValue,row.receiptId]));
 expect(caseVoiceRequests(puzzle,personas).every(row=>row.request.fact.length>0)).toBe(true);
 await expect(applyVoice(puzzle,personas,async()=>'I saw nothing at all.')).rejects.toMatchObject({code:'VOICE_CASE_INVALID'});
},120_000);
