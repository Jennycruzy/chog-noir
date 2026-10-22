import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import {WitnessConnections} from '../src/connections.mts';
import type {OwnerSnapshot} from '../src/holders.mts';
import type {MetadataRecord} from '../src/roster.mts';
import {ZERO} from '../../core/src/chain.mts';
import {cleanTrait} from '../../traits/src/traits.mts';

const {snapshot}=JSON.parse(readFileSync(new URL('./fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot};
const {tokens}=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:MetadataRecord['metadata'];source:{uri:string;fetchedAt:string}}[]};
const metadata=new Map(tokens.map(row=>[row.tokenId,{metadata:row.metadata,...row.source}]));
const connections=new WitnessConnections({snapshot,metadata,atBlock:snapshot.indexedBlock});
const orderedMints=snapshot.transfers.filter(row=>row.from===ZERO).sort((a,b)=>a.block-b.block||a.logIndex-b.logIndex);

test('rare appearance links use the actual trait identity and stored metadata sources',()=>{
 const groups=new Map<string,number[]>();
 for(const row of tokens)for(const trait of row.metadata.attributes){const identity=JSON.stringify(trait);groups.set(identity,[...(groups.get(identity)??[]),row.tokenId]);}
 const group=[...groups].find(([identity,ids])=>JSON.parse(identity).trait_type==='Head'&&ids.length>=2&&ids.length<=196)!;
 expect(group).toBeDefined();const [identity,ids]=group,trait=JSON.parse(identity),links=connections.between(ids[0]!,ids[1]!);
 const match=links.find(row=>row.kind==='LOOK'&&row.traitType==='Head'&&row.reason==='same '+cleanTrait('Head',trait.value).display);
 const sources=ids.slice(0,2).map(id=>{const source=tokens.find(row=>row.tokenId===id)!.source;return {kind:'METADATA',uri:source.uri,fetchedAt:source.fetchedAt};});
 expect(match).toMatchObject({kind:'LOOK',holders:ids.length,sources});
 if(match?.kind==='LOOK')expect(match.traitId).toMatch(/^[a-f0-9]{64}$/);
 expect(links.filter(row=>row.kind==='LOOK').every(row=>row.holders<=196)).toBe(true);
});
test('Legendary labels and one-of-one Base never create appearance links',()=>{
 const legends=tokens.filter(row=>row.metadata.attributes.some(trait=>trait.trait_type==='Base'&&trait.value==='1:1'));
 expect(legends).toHaveLength(10);
 for(let i=0;i<legends.length;i++)for(let j=i+1;j<legends.length;j++)expect(connections.between(legends[i]!.tokenId,legends[j]!.tokenId).filter(row=>row.kind==='LOOK')).toEqual([]);
 expect(connections.between(1,1)).toEqual([]);
 expect(()=>connections.between(0,1)).toThrow();
});
test('mint links follow receipt order rather than token ids or shuffled display names',()=>{
 const first=orderedMints[0]!,tenth=orderedMints[10]!,fiftieth=orderedMints[50]!,later=orderedMints[51]!;
 expect(connections.between(first.tokenId,tenth.tokenId).find(row=>row.kind==='MINT')).toMatchObject({distance:10,reason:'minted minutes apart',sources:[{tx:first.tx,block:first.block,logIndex:first.logIndex},{tx:tenth.tx,block:tenth.block,logIndex:tenth.logIndex}]});
 expect(connections.between(first.tokenId,fiftieth.tokenId).find(row=>row.kind==='MINT')).toMatchObject({distance:50,reason:'minted close together'});
 expect(connections.between(first.tokenId,later.tokenId).some(row=>row.kind==='MINT')).toBe(false);
});
test('wallet links carry both arrival receipts and exclude future co-ownership',()=>{
 const cutoff=Math.max(...orderedMints.map(row=>row.block)),earlier=new WitnessConnections({snapshot,metadata,atBlock:cutoff});
 const byWallet=new Map<string,Set<number>>();
 for(const row of snapshot.transfers)if(row.to!==ZERO){const ids=byWallet.get(row.to)??new Set<number>();ids.add(row.tokenId);byWallet.set(row.to,ids);}
 let chosen:{first:number;second:number}|undefined;
 for(const ids of byWallet.values()){
  const list=[...ids];for(let i=0;i<list.length&&!chosen;i++)for(let j=i+1;j<list.length&&!chosen;j++){
   const first=list[i]!,second=list[j]!;
   if(!earlier.between(first,second).some(row=>row.kind==='WALLET')&&connections.between(first,second).some(row=>row.kind==='WALLET'))chosen={first,second};
  }if(chosen)break;
 }
 expect(chosen).toBeDefined();const link=connections.between(chosen!.first,chosen!.second).find(row=>row.kind==='WALLET')!;
 expect(link.kind).toBe('WALLET');expect(link.sources).toHaveLength(2);
 const arrivals=link.sources.map(source=>snapshot.transfers.find(row=>row.tx===('tx' in source?source.tx:'')&&row.logIndex===('logIndex' in source?source.logIndex:-1))!);
 expect(arrivals.map(row=>row.tokenId)).toEqual([chosen!.first,chosen!.second]);expect(arrivals[0]!.to).toBe(arrivals[1]!.to);expect(arrivals.some(row=>row.block>cutoff)).toBe(true);
 expect(JSON.stringify(link)).not.toContain(arrivals[0]!.to);
});
test('connection input rejects incomplete history and metadata and returns isolated values',()=>{
 expect(()=>new WitnessConnections({snapshot,metadata,atBlock:snapshot.indexedBlock+1})).toThrow();
 expect(()=>new WitnessConnections({snapshot,metadata:new Map(),atBlock:snapshot.indexedBlock})).toThrow();
 expect(()=>new WitnessConnections({snapshot,metadata,atBlock:orderedMints[0]!.block})).toThrow();
 const first=orderedMints[0]!.tokenId,second=orderedMints[1]!.tokenId,links=connections.between(first,second);links[0]!.reason='changed';
 expect(connections.between(first,second).some(row=>row.reason==='changed')).toBe(false);
});

test('a wallet trail needs a real bridge Chog and carries all four arrival receipts',()=>{
 const pairs:{detective:number;witness:number}[]=[];
 for(let detective=1;detective<=200&&pairs.length<3;detective++)for(let witness=detective+1;witness<=1969&&pairs.length<3;witness++){const links=connections.between(detective,witness);if(links.some(row=>row.kind==='TRAIL')&&!links.some(row=>row.kind==='WALLET'))pairs.push({detective,witness});}
 expect(pairs.length).toBeGreaterThan(0);
 for(const {detective,witness} of pairs){
  const link=connections.between(detective,witness).find(row=>row.kind==='TRAIL')!;if(link.kind!=='TRAIL')throw new Error('trail');
  const arrivals=link.sources.map(source=>snapshot.transfers.find(row=>row.tx===source.tx&&row.logIndex===source.logIndex)!);
  expect(arrivals.map(row=>row.tokenId)).toEqual([detective,link.bridge,link.bridge,witness]);
  expect(arrivals[0]!.to).toBe(arrivals[1]!.to);expect(arrivals[2]!.to).toBe(arrivals[3]!.to);expect(arrivals[0]!.to).not.toBe(arrivals[2]!.to);
  expect(JSON.stringify(link)).not.toContain(arrivals[0]!.to);
 }
});
