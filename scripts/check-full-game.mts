import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {loadGame} from '../apps/api/src/game.mts';
import {cards} from '../packages/witness/src/lines.mts';
import {memoryLine,freezeMemories} from '../packages/witness/src/facts.mts';
import {planFullLie} from '../packages/witness/src/lie.mts';
import {bindCaseContent,validateCase,type Metadata} from '../packages/cases/src/build.mts';
import {dailyDraft} from '../packages/publishing/src/publish.mts';
import {createSession,play,viewSession} from '../packages/game/src/session.mts';
import {traitDictionary} from '../packages/traits/src/traits.mts';
import {comic,shareCard} from '../packages/art/src/render.mts';
import {lookupDesk} from '../packages/detector/src/desk.mts';
const root=fileURLToPath(new URL('../',import.meta.url)),data=await loadGame(root),metadata=new Map<number,Metadata>();
for(let start=1;start<=1969;start+=64)await Promise.all(Array.from({length:Math.min(64,1970-start)},async(_,offset)=>{const id=start+offset;metadata.set(id,JSON.parse(await readFile(join(root,`data/metadata/${id}.json`),'utf8')).metadata);}));
assert.equal(data.allPartners.length,1969);
assert.ok(data.allPartners.every(partner=>['XRAY','ANALYST','TAKES_ONE','EMPATH'].includes(partner.power)&&partner.uses>=1&&partner.uses<=3));
assert.ok(!/boob|milf|retard|horny|boner|\bbbc\b|thots|buttcoin/i.test(JSON.stringify(data.allPartners)));
const summaries=[];let testimony=0;
for(const original of data.cases){
 assert.deepEqual(validateCase(original),[]);
 for(const member of original.public.cast)for(const card of cards){memoryLine(original,member.tokenId,card);memoryLine(original,member.tokenId,card,true);testimony+=2;}
 let draft=planFullLie(dailyDraft(original,'2026-10-18'),metadata);freezeMemories(draft);draft=bindCaseContent(draft);assert.deepEqual(validateCase(draft),[]);
 const lie=draft.private.key.lie,partner=data.allPartners.find(item=>item.power==='EMPATH')!;
 let session=createSession(draft,partner);
 const act=(input:Record<string,unknown>)=>{session=play(draft,session,{revision:session.revision,...input});};
 act({type:'ask',tokenId:lie.witness,card:lie.card});act({type:'open',factId:lie.ledgerId});act({type:'accuse',tokenId:lie.witness,card:lie.card,factId:lie.ledgerId});act({type:'submit',answers:draft.private.key.answers});
 assert.equal(session.caught,true);assert.equal(viewSession(draft,session).result!.grade,'A');
 const changed=structuredClone(draft);changed.public.questions[0]!.options[0]!.label='Edited after commitment';assert.ok(validateCase(changed).includes('CONTENT_HASH'));
 summaries.push({sourceCase:original.public.id,witnesses:original.public.cast.length,cards:10,plannedLieCard:lie.card,contentBound:true,score:viewSession(draft,session).result!.score});
}
await mkdir(join(root,'runs/game-completion'),{recursive:true,mode:0o700});
const sample=data.cases[0]!,png=await comic(root,sample),share=await shareCard(root,sample,{score:550,grade:'A'},5,8,true);
const comicMetadata=await sharp(png).metadata(),shareMetadata=await sharp(share).metadata();
assert.equal(comicMetadata.width,1080);assert.equal(comicMetadata.height,1350);assert.equal(shareMetadata.width,1200);assert.equal(shareMetadata.height,630);assert.ok(share.length<=300_000);
await writeFile(join(root,'runs/game-completion/comic.png'),png);await writeFile(join(root,'runs/game-completion/share.png'),share);
let provenRecords=0;
if(data.context.desk){const desk=data.context.desk;const target=desk.findings.find(item=>item.result.status==='SYNTHETIC_RECORD'&&item.result.sender)?.result.sender;if(target)assert.equal(lookupDesk(target,desk).status,'PROVEN_RECORDS');provenRecords=desk.sourceChecks.filter(item=>item.errors.length===0).length;}
const dictionary=traitDictionary(metadata),reviewPath=join(root,'runs/game-completion/trait-labels-review.json');
// Raw metadata is retained in this private review packet; the public API receives only clean labels.
await writeFile(reviewPath,JSON.stringify(dictionary,null,2),{mode:0o600});
const report={checkedAt:new Date().toISOString(),status:'PASS',cases:summaries.length,partners:data.allPartners.length,partnerCounts:{powers:Object.fromEntries(['XRAY','ANALYST','TAKES_ONE','EMPATH'].map(power=>[power,data.allPartners.filter(item=>item.power===power).length])),moneyTalk:data.allPartners.filter(item=>item.moneyTalk).length,special:data.allPartners.filter(item=>item.special).length,sides:Object.fromEntries(['BUYER','SELLER'].map(side=>[side,data.allPartners.filter(item=>item.side===side).length]))},cardVariantsValidated:testimony,cleanTraitValues:dictionary.values.length,traitReview:'PENDING_USER_REVIEW',claudeEvaluation:'DEFERRED',provenRecords,comic:{width:comicMetadata.width,height:comicMetadata.height},share:{width:shareMetadata.width,height:shareMetadata.height,bytes:share.length,limitBytes:300_000},onchainWrites:0,summaries};
await writeFile(join(root,'docs/audit/evidence/full-game.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
