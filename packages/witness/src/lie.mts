import {keccak256,toBytes} from 'viem';
import {answerHash,validateCase,type CaseDraft,type Metadata} from '../../cases/src/build.mts';
import {memoryLine,type Card} from './facts.mts';
export function planFullLie(input:CaseDraft,metadata:ReadonlyMap<number,Metadata>):CaseDraft{
 const draft=structuredClone(input);delete draft.private.key.contentHash;
 if(!draft.private.facts)throw new Error('LIE_FACTS: Build source-backed fact sheets first');
 for(const memory of Object.values(draft.private.facts))delete memory.frozen;
 const ranked=draft.public.cast.map(member=>{
  const item=metadata.get(member.tokenId);if(!item)throw new Error('LIE_METADATA: Missing witness');
  const attr=(name:string)=>item.attributes.find(trait=>trait.trait_type===name)?.value.toLowerCase()??'';
  return {member,score:(['side eye','smirk','thug','mog','clown eye','clown eye mix'].includes(attr('Eyes'))?3:0)+(['clown','clown mouth'].includes(attr('Mouth'))?1:0)+(attr('Form')==='skull'?1:0)};
 }).sort((a,b)=>b.score-a.score||b.member.tokenId-a.member.tokenId);
 const entropy=BigInt(keccak256(toBytes(draft.private.salt)));
 const witness=(ranked[0]!.score>0?ranked[0]!:ranked[Number(entropy%BigInt(ranked.length))]!).member,memory=draft.private.facts[witness.tokenId]!;
 const preferred:Card[]=draft.public.type==='LONG_GOODBYE'?['LONGEST_HOLD','OWNER_COUNT','LAST_NIGHT']:['OWNER_COUNT','LAST_NIGHT','LONGEST_HOLD'];
 const rotation=Number((entropy>>8n)%3n);preferred.push(...preferred.splice(0,rotation));
 let card:Card|undefined,truth='',claim='';
 for(const candidate of preferred){
  const fact=memory.cards[candidate];if(fact.unknown)continue;
  const value=fact.detail.match(/\d+/);if(!value)continue;
  card=candidate;truth=fact.detail;
  const amount=1+Number((entropy>>16n)%2n),direction=(entropy>>24n)%2n===0n?-1:1,original=Number(value[0]);
  const changed=original+direction*amount<0?original+amount:original+direction*amount;
  claim=truth.replace(value[0],String(changed));break;
 }
 if(!card)return draft;
 const old=draft.private.key.lie;
 const previous=draft.public.ledger.find(fact=>fact.id===old.ledgerId);
 if(old.ledgerId.startsWith('memory-'))draft.public.ledger=draft.public.ledger.filter(fact=>fact.id!==old.ledgerId);
 else if(previous)previous.sealed=false;
 const ledgerId=`memory-${witness.tokenId}-${card.toLowerCase()}`;
 draft.public.ledger.push({id:ledgerId,text:`${memory.name}: ${truth}.`,sources:memory.cards[card].sources,sealed:true});
 draft.private.key.lie={witness:witness.tokenId,card,ledgerId,truth,claim};
 draft.public.testimony=draft.public.cast.map(member=>({tokenId:member.tokenId,card:'ARRIVAL' as const,line:memoryLine(draft,member.tokenId,'ARRIVAL').line}));
 draft.public.answerHash=answerHash(draft.public.id,draft.private.key,draft.private.salt);
 if(validateCase(draft).length)throw new Error('LIE_VALIDATION: Planned lie does not match its evidence');
 // Verify the false value is expressed by exactly its chosen testimony card.
 const line=memoryLine(draft,witness.tokenId,card);if(!line.line.includes(claim)||line.line.includes(truth))throw new Error('LIE_LINE: False claim is not isolated');
 return draft;
}
