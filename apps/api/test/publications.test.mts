import {test,expect,vi} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {AddressInfo} from 'node:net';
import type {CaseChain,ChainReceipt} from '../../../packages/chain/src/casebook.mts';
import {Publisher} from '../../../packages/publishing/src/publish.mts';
import {localVault} from '../../../packages/publishing/src/vault.mts';
import {gameServer} from '../src/game.mts';
import {publishedCases} from '../src/publications.mts';
import {draft,partner} from '../../../packages/game/test/fixture.mts';

test('one corrupted publication is reported once while the archive and other daily cases remain playable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-publications-')),address=('0x'+'12'.repeat(20)) as `0x${string}`,now=Math.floor(Date.now()/1000),day=new Date().toISOString().slice(0,10);
 const state=new Map<string,{hash:`0x${string}`;closed:boolean;opensAt:number;closesAt:number}>();
 const receipt:ChainReceipt={hash:('0x'+'34'.repeat(32)) as `0x${string}`,blockHash:('0x'+'56'.repeat(32)) as `0x${string}`,blockNumber:'100',timestamp:now-1,status:'success',chainId:143,address};
 const chain:CaseChain={address,async inspect(id){return state.get(id)??{hash:('0x'+'00'.repeat(32)) as `0x${string}`,closed:false,opensAt:0,closesAt:0};},async open(item,opensAt,closesAt){state.set(item.public.id,{hash:item.public.answerHash as `0x${string}`,closed:false,opensAt,closesAt});return receipt;},async close(){throw new Error('Not used');},async cast(){throw new Error('Not used');}};
 const publisher=new Publisher(join(root,'runs/publications'),await localVault(join(root,'runs/publication-vault')),chain);
 for(const kind of ['MAIN','COLD'] as const){const record=await publisher.prepare(draft,day,'FRESH',now-10,now+3600,kind);await publisher.publish(record.id);}
 const path=join(root,'runs/publications',day+'-main.json'),corrupt=JSON.parse(await readFile(path,'utf8'));corrupt.answerHash='0x'+'00'.repeat(32);await writeFile(path,JSON.stringify(corrupt));
 const log=vi.spyOn(console,'error').mockImplementation(()=>{}),server=gameServer({root,cases:[draft],partners:[partner],secure:false});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  const health=await fetch(origin+'/health').then(response=>response.json());expect(health.publicationErrors).toEqual([{caseId:day+'-main',code:'PUBLICATION_RECORD_INVALID'}]);
  for(let i=0;i<3;i++){const cases=await fetch(origin+'/api/cases').then(response=>response.json());expect(cases.cases.map((item:{id:string})=>item.id)).toEqual([draft.public.id,day+'-cold']);}
  expect(log).toHaveBeenCalledTimes(1);
  const response=await fetch(origin+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({caseId:day+'-cold',partnerId:partner.tokenId})});expect(response.status).toBe(201);expect((await response.json()).caseId).toBe(day+'-cold');
  const coldPath=join(root,'runs/publications',day+'-cold.json'),unsafe=JSON.parse(await readFile(coldPath,'utf8'));unsafe.status='CLOSED';unsafe.close={...receipt,address:'0x'+'99'.repeat(20)};await writeFile(coldPath,JSON.stringify(unsafe));const rejected=await publishedCases(root);expect(rejected.drafts).toEqual([]);expect(rejected.errors.map(item=>item.caseId).sort()).toEqual([day+'-cold',day+'-main']);
 }finally{log.mockRestore();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
},60_000);
