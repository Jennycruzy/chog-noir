import {test,expect,vi} from 'vitest';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {gameServer} from '../src/game.mts';
import type {PublicContext} from '../src/context.mts';
import {draft,partner} from '../../../packages/game/test/fixture.mts';
import {traitsFor} from '../../../packages/traits/src/traits.mts';
import type {Metadata} from '../../../packages/cases/src/build.mts';
import type {EnrichedEvent} from '../../../packages/core/src/enrich.mts';
const fixture=JSON.parse(await readFile(new URL('../../../packages/cases/test/fixtures/sales.json',import.meta.url),'utf8')) as {rows:EnrichedEvent[];times:[number,number][]};
const metadata=JSON.parse(await readFile(new URL('../../../packages/cases/test/fixtures/metadata.json',import.meta.url),'utf8')) as Record<string,Metadata>;
test('profile history reloads a newer saved source within one thirty-second refresh',async()=>{
 const root=await mkdtemp(join(tmpdir(),'chog-history-refresh-')),row=fixture.rows.find(item=>item.event.class==='SALE')!,id=row.event.tokenId,now=Date.now();
 const context:PublicContext={profiles:new Map([[id,traitsFor(id,metadata[id]!)]]),history:[],times:new Map(),toBlockExclusive:0,coverageAt:0,desk:null};
 const server=gameServer({root,cases:[draft],partners:[partner],context,secure:false});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,clock=vi.spyOn(Date,'now').mockReturnValue(now);
 try{
  expect((await fetch(origin+'/api/chog/'+id).then(response=>response.json())).moves).toEqual([]);
  const directory=join(root,'runs/daily/source');await mkdir(directory,{recursive:true});
  const at=new Map(fixture.times).get(row.event.block)!;
  await writeFile(join(directory,'enriched.json'),JSON.stringify({events:[row]}));
  await writeFile(join(directory,'history.json'),JSON.stringify({toBlockExclusive:row.event.block+1,coverageAt:at,data:{blocks:[{number:row.event.block,timestamp:at}]}}));
  clock.mockReturnValue(now+30_001);
  const profile=await fetch(origin+'/api/chog/'+id).then(response=>response.json());expect(profile.moves).toHaveLength(1);expect(profile.moves[0].source.tx).toBe(row.event.tx);expect(profile.toBlockExclusive).toBe(row.event.block+1);
 }finally{clock.mockRestore();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
},60_000);
