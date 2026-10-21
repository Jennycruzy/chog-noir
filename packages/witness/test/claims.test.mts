import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import {ClaimCatalog,lieKinds,noirWalletLabels,verifiedBulkCompanions,type BulkSource} from '../src/claims.mts';
import type {Metadata} from '../../cases/src/build.mts';
import type {EnrichedEvent,Source} from '../../core/src/enrich.mts';
import type {OwnerSnapshot} from '../../auth/src/holders.mts';
import {buildOwnership} from '../../core/src/owners.mts';
import {CHOG,CHOG_TOKEN,WMON,ZERO} from '../../core/src/chain.mts';
import type {LieKind} from '../../cases/src/puzzle.mts';

interface Fixture {cutoff:Source;rows:EnrichedEvent[];times:[number,number][];walletLabels:[string,string][];bulkSources:BulkSource[];examples:{kind:LieKind;tokenId:number;relatedTokenIds:number[];claimId:string}[]}
const fixture=JSON.parse(readFileSync(new URL('./fixtures/claim-history.json',import.meta.url),'utf8')) as Fixture;
const {snapshot:ownership}=JSON.parse(readFileSync(new URL('../../auth/test/fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot};
const {tokens}=JSON.parse(readFileSync(new URL('../../traits/test/fixtures/detectives.json',import.meta.url),'utf8')) as {tokens:{tokenId:number;metadata:Metadata}[]};
const metadata=new Map(tokens.map(row=>[row.tokenId,row.metadata])),peers=[...new Set(fixture.rows.map(row=>row.event.tokenId))];
const input={history:fixture.rows,times:new Map(fixture.times),metadata,ownership,cutoff:fixture.cutoff,walletLabels:new Map(fixture.walletLabels),bulkSources:fixture.bulkSources};
const book=new ClaimCatalog(input),sourceKey=(row:Source)=>row.tx+':'+row.logIndex;

for(const kind of lieKinds)test(kind+' produces a sourced contradiction from stored Monad records',()=>{
 const example=fixture.examples.find(row=>row.kind===kind);expect(example).toBeDefined();
 const claim=book.forToken(example!.tokenId,peers).claims.find(row=>row.kind===kind)!;
 expect(claim).toBeDefined();expect(claim.id).toBe(example!.claimId);expect(claim.trueValue).not.toBe(claim.falseValue);
 expect(claim.receipt.facts).toContainEqual({id:claim.factId,value:claim.trueValue});expect(claim.receipt.sources.length).toBeGreaterThan(0);
 expect(claim.receipt.text).not.toContain(claim.falseValue);expect(claim.receipt.exactText).not.toContain(claim.falseValue);expect(claim.inference).toBeTruthy();expect(claim.unlockLine).toBeTruthy();
 const known=new Set<string>();for(const row of fixture.rows){known.add(sourceKey({tx:row.event.tx,block:row.event.block,logIndex:row.event.logIndex}));for(const logIndex of row.event.evidence.orderLogIndices)known.add(sourceKey({tx:row.event.tx,block:row.event.block,logIndex}));if(row.event.escrow){const paid=row.event.escrow.paid;known.add(sourceKey(paid));if(row.event.escrow.paymentProof.kind==='ERC20'){const log=row.event.escrow.paymentProof.log;known.add(sourceKey({tx:log.transactionHash,block:log.blockNumber,logIndex:log.logIndex}));}}}
 for(const source of claim.receipt.sources)expect(known.has(sourceKey(source))).toBe(true);
});
test('owner count and first-move claims use mint history rather than a missing-data default',()=>{
 const count=fixture.examples.find(row=>row.kind==='D3')!,first=fixture.examples.find(row=>row.kind==='I4')!;
 const owners=new Set(fixture.rows.filter(row=>row.event.tokenId===count.tokenId&&row.event.to!==ZERO).map(row=>row.event.to));
 expect(book.forToken(count.tokenId,peers).claims.find(row=>row.kind==='D3')!.trueValue).toContain('has '+owners.size+' recorded owners');
 const moves=fixture.rows.filter(row=>row.event.tokenId===first.tokenId&&row.event.from!==row.event.to);expect(moves).toHaveLength(2);expect(moves[0]!.event.from).toBe(ZERO);
 const missing=fixture.rows.filter(row=>!(row.event.tokenId===count.tokenId&&row.event.from===ZERO));
 expect(()=>new ClaimCatalog({...input,history:missing})).toThrow();
});
test('independent indexed transfers catch an omitted round trip even when the remaining owner chain is continuous',()=>{
 const moves=fixture.rows.filter(row=>row.event.tokenId===1021&&row.event.from!==row.event.to);
 let pair:EnrichedEvent[]|undefined;
 for(let index=0;index<moves.length-1;index++){const first=moves[index]!,second=moves[index+1]!;if(first.event.from===second.event.to&&first.event.to===second.event.from&&sourceKey(first.event)!==sourceKey(fixture.cutoff)&&sourceKey(second.event)!==sourceKey(fixture.cutoff)){pair=[first,second];break;}}
 expect(pair).toBeDefined();const removed=new Set(pair!.map(row=>sourceKey(row.event))),history=fixture.rows.filter(row=>!removed.has(sourceKey(row.event)));
 expect(()=>buildOwnership(history.map(row=>row.event),input.times)).not.toThrow();
 expect(()=>new ClaimCatalog({...input,history})).toThrow('every indexed transfer');
});
test('bulk links need a real shared sender-signed action and never assert common ownership',()=>{
 const example=fixture.examples.find(row=>row.kind==='I3')!,claim=book.forToken(example.tokenId,peers).claims.find(row=>row.kind==='I3')!;
 expect(claim.inference).toContain('does not establish common ownership');expect(claim.relatedTokenIds).toHaveLength(1);
 const raw=fixture.bulkSources[0]!;expect(verifiedBulkCompanions(raw).length).toBeGreaterThan(0);
 const invalid=structuredClone(raw);invalid.transaction.from=fixture.walletLabels.find(([wallet])=>wallet!==raw.transaction.from)![0];expect(verifiedBulkCompanions(invalid)).toEqual([]);
 expect(()=>verifiedBulkCompanions({...raw,fetchedAt:''})).toThrow('fetch time');
 const noProof=new ClaimCatalog({...input,bulkSources:[]}).forToken(example.tokenId,peers);expect(noProof.claims.some(row=>row.kind==='I3')).toBe(false);expect(noProof.unavailable).toContainEqual({kind:'I3',tokenId:example.tokenId,reason:'CLAIM_PROOF_UNAVAILABLE'});
});
test('CHOG evidence requires the official token and the exact seller payout',()=>{
 const example=fixture.examples.find(row=>row.kind==='I6')!;
 const original=book.forToken(example.tokenId,peers).claims.find(row=>row.kind==='I6')!;
 expect(original.receipt.text).toBe(original.receipt.exactText);expect(original.receipt.text).not.toContain('about ');
 const changed=structuredClone(fixture.rows);
 for(const row of changed)if(row.event.escrow?.paymentToken===CHOG_TOKEN&&row.event.escrow.paymentProof.kind==='ERC20')row.event.escrow.paymentProof.log.address=WMON;
 const claims=new ClaimCatalog({...input,history:changed}).forToken(example.tokenId,peers);
 expect(claims.claims.some(row=>row.kind==='I6')).toBe(false);
 expect(claims.unavailable.some(row=>row.kind==='I6')).toBe(true);
});
test('ERC20 evidence accepts padded empty slots but rejects an extra populated topic',()=>{
 const example=fixture.examples.find(row=>row.kind==='I6')!;
 expect(book.forToken(example.tokenId,peers).claims.some(row=>row.kind==='I6')).toBe(true);
 const changed=structuredClone(fixture.rows);
 for(const row of changed)if(row.event.escrow?.paymentToken===CHOG_TOKEN&&row.event.escrow.paymentProof.kind==='ERC20')row.event.escrow.paymentProof.log.topics=[...row.event.escrow.paymentProof.log.topics.slice(0,3),'0x'+'00'.repeat(32)];
 expect(new ClaimCatalog({...input,history:changed}).forToken(example.tokenId,peers).claims.some(row=>row.kind==='I6')).toBe(false);
});
test('unclassified arrivals cannot become direct arrival or wallet answers',()=>{
 const example=fixture.examples.find(row=>row.kind==='D1')!,changed=structuredClone(fixture.rows);
 const current=changed.filter(row=>row.event.tokenId===example.tokenId&&row.event.from!==row.event.to).at(-1)!;current.event.class='UNCLASSIFIED';
 const result=new ClaimCatalog({...input,history:changed}).forToken(example.tokenId,peers);
 for(const kind of ['D1','D4'])expect(result.claims.some(row=>row.kind===kind)).toBe(false);
});
test('future moves and raw proof edits cannot silently alter the committed-cutoff claims',()=>{
 const example=fixture.examples.find(row=>row.kind==='I3')!,saved=book.forToken(example.tokenId,peers),changed=structuredClone(fixture.bulkSources);
 const actual=changed.flatMap(row=>row.logs).find(log=>log.address===CHOG)!;actual.blockNumber++;
 expect(()=>new ClaimCatalog({...input,bulkSources:changed})).toThrow();
 const future=structuredClone(fixture.rows[0]!);future.event.block=fixture.cutoff.block+100;
 expect(new ClaimCatalog({...input,history:[...fixture.rows,future]}).forToken(example.tokenId,peers)).toEqual(saved);
 const reversed=new ClaimCatalog({...input,history:[...fixture.rows].reverse(),bulkSources:[...fixture.bulkSources].reverse()});expect(reversed.forToken(example.tokenId,[...peers].reverse())).toEqual(saved);
});
test('wallet aliases are deterministic, distinct within the case and contain no addresses',()=>{
 const wallets=fixture.walletLabels.map(([wallet])=>wallet),salt='0x'+'a1'.repeat(32),labels=noirWalletLabels(wallets,salt);
 expect([...labels]).toEqual([...noirWalletLabels([...wallets].reverse(),salt)]);expect(new Set(labels.values()).size).toBe(labels.size);for(const label of labels.values())expect(label).not.toMatch(/0x[a-f0-9]{40}/i);
 expect(()=>noirWalletLabels(wallets,'0x00')).toThrow();
});
