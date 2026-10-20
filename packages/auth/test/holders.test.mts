import {readFileSync} from 'node:fs';
import {test,expect,vi} from 'vitest';
import {getAddress} from 'viem';
import {HolderDirectory,ownerDirectory,type OwnerSnapshot} from '../src/holders.mts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/owners.json',import.meta.url),'utf8')) as {snapshot:OwnerSnapshot;checkedOwners:{tokenId:number;owner:string;arrivalTimestamp:number;founder:boolean}[]};
test('full stored transfer history reproduces all independently checked owners and arrival times',()=>{
 const owners=ownerDirectory(fixture.snapshot);
 expect(owners.size).toBe(1969);
 expect(fixture.checkedOwners).toHaveLength(50);
 for(const checked of fixture.checkedOwners){
  expect(owners.get(checked.tokenId)).toMatchObject({owner:getAddress(checked.owner),heldSince:checked.arrivalTimestamp,founder:checked.founder});
 }
 expect([...owners.values()].some(row=>row.founder)).toBe(true);
 expect(owners.get(1021)?.founder).toBe(false);
});
test('a fresh index lists held tokens, but starting also needs an independent owner read',async()=>{
 const chosen=fixture.checkedOwners[0]!,other=fixture.checkedOwners.find(row=>row.owner!==chosen.owner)!;
 const ownerOf=vi.fn(async()=>chosen.owner);
 const directory=new HolderDirectory({snapshot:async()=>fixture.snapshot,now:()=>fixture.snapshot.indexedAt+59_999,ownerOf});
 expect((await directory.held(chosen.owner)).some(row=>row.tokenId===chosen.tokenId)).toBe(true);
 expect((await directory.start(chosen.owner,chosen.tokenId)).tokenId).toBe(chosen.tokenId);
 expect(ownerOf).toHaveBeenCalledWith(chosen.tokenId);
 ownerOf.mockResolvedValue(other.owner);
 await expect(directory.start(chosen.owner,chosen.tokenId)).rejects.toMatchObject({code:'HOLDER_NOT_OWNER'});
 expect(await directory.submission(chosen.owner,chosen.tokenId)).toEqual({transferredMidCase:true});
 ownerOf.mockResolvedValue(chosen.owner);
 expect(await directory.submission(chosen.owner,chosen.tokenId)).toEqual({transferredMidCase:false});
 ownerOf.mockRejectedValue(new Error('RPC unavailable'));
 await expect(directory.submission(chosen.owner,chosen.tokenId)).rejects.toMatchObject({code:'HOLDER_RPC_UNAVAILABLE',status:503});
});
test('ownership checks fail closed on stale, incomplete or wrong-chain histories',async()=>{
 const chosen=fixture.checkedOwners[0]!;
 const ownerOf=vi.fn(async()=>chosen.owner);
 const directory=new HolderDirectory({snapshot:async()=>fixture.snapshot,now:()=>fixture.snapshot.indexedAt+60_000,ownerOf});
 await expect(directory.start(chosen.owner,chosen.tokenId)).rejects.toMatchObject({code:'HOLDER_INDEX_STALE'});
 expect(ownerOf).not.toHaveBeenCalled();
 const missing=structuredClone(fixture.snapshot);missing.transfers=missing.transfers.filter(row=>row.tokenId!==1);
 expect(()=>ownerDirectory(missing)).toThrow('incomplete');
 const wrong=structuredClone(fixture.snapshot);Object.assign(wrong,{chainId:10143});
 expect(()=>ownerDirectory(wrong)).toThrow('invalid');
 const gap=structuredClone(fixture.snapshot);const move=gap.transfers.find(row=>row.from!=='0x0000000000000000000000000000000000000000'&&row.from!==row.to)!;
 move.from='0x0000000000000000000000000000000000000001';
 expect(()=>ownerDirectory(gap)).toThrow('gap');
});
test('a wallet with no Chog cannot start a holder case',async()=>{
 const owners=ownerDirectory(fixture.snapshot),occupied=new Set([...owners.values()].map(row=>row.owner.toLowerCase()));
 const empty='0x0000000000000000000000000000000000000001';expect(occupied.has(empty)).toBe(false);
 const ownerOf=vi.fn(async()=>empty);
 const directory=new HolderDirectory({snapshot:async()=>fixture.snapshot,now:()=>fixture.snapshot.indexedAt,ownerOf});
 expect(await directory.held(empty)).toEqual([]);
 await expect(directory.start(empty,1)).rejects.toMatchObject({code:'HOLDER_NO_CHOG'});
 expect(ownerOf).not.toHaveBeenCalled();
});
