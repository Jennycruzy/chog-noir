import {test,expect} from 'vitest';
import {answerHash,type Metadata} from '../../cases/src/build.mts';
import {createSession,play,viewSession,starterPartners,type Session} from '../src/session.mts';
import {draft,partner} from './fixture.mts';
const start=()=>createSession(draft,partner);
const act=(session:Session,input:Record<string,unknown>)=>play(draft,session,{revision:session.revision,...input});

test('unplayed projection excludes key, salts, sealed contents, testimony and raw cast arrival sources',()=>{
 const view=viewSession(draft,start()),json=JSON.stringify(view);
 expect(json).not.toContain('answerValue');expect(json).not.toContain('ledgerId');expect(json).not.toContain('arrivedAt');
 expect(json).not.toContain('"salt"');expect(json).not.toContain('"key"');expect(view.result).toBe(null);
 expect(view.testimony).toEqual([]);
 for(const fact of draft.public.ledger.filter(item=>item.sealed)){
  expect(view.ledger.find(item=>item.id===fact.id)).not.toHaveProperty('text');
  expect(json).not.toContain(fact.text);
 }
 for(const question of view.case.questions)for(const option of question.options){expect(option).not.toHaveProperty('sources');expect(option).not.toHaveProperty('value');}
});
test('asking charges once, rejects outsiders, and stale actions cannot charge a second time',()=>{
 const session=start(),next=act(session,{type:'ask',tokenId:draft.public.cast[0]!.tokenId});
 expect(next.plays).toBe(7);expect(session.plays).toBe(8);
 expect(act(next,{type:'ask',tokenId:draft.public.cast[0]!.tokenId}).plays).toBe(7);
 expect(()=>act(next,{type:'ask',tokenId:99999})).toThrow('Choose a witness');
 expect(()=>play(draft,next,{type:'ask',tokenId:draft.public.cast[1]!.tokenId,revision:0})).toThrow('The case changed');
});
test('sealed records cost two, unsealed examination is free and repeated reads are free',()=>{
 let session=act(start(),{type:'open',factId:'subject'});expect(session.plays).toBe(8);
 session=act(session,{type:'open',factId:'price'});expect(session.plays).toBe(6);
 expect(viewSession(draft,session).ledger.find(item=>item.id==='price')).toHaveProperty('text');
 expect(act(session,{type:'open',factId:'price'}).plays).toBe(6);
});
test('partner powers unseal once; Analyst is confined to payment; Empath receives two extra plays',()=>{
 const xray=act(start(),{type:'power',factId:draft.private.key.lie.ledgerId});expect(xray.plays).toBe(8);
 expect(()=>act(xray,{type:'power',factId:'price'})).toThrow('already used');
 const analyst=createSession(draft,{...partner,power:'ANALYST'});
 const next=act(analyst,{type:'power',factId:draft.private.key.lie.ledgerId});expect(next.unsealed).toEqual(['price']);
 const empath=createSession(draft,{...partner,power:'EMPATH'});expect(empath.plays).toBe(10);expect(empath.initialPlays).toBe(10);
 expect(()=>act(empath,{type:'power',factId:'price'})).toThrow('already used');
});
test('catching a lie requires questioning its witness and opening the exact contradicting record',()=>{
 const lie=draft.private.key.lie;
 expect(()=>act(start(),{type:'accuse',tokenId:lie.witness,factId:lie.ledgerId})).toThrow('Question this witness');
 let session=act(start(),{type:'ask',tokenId:lie.witness});
 expect(()=>act(session,{type:'accuse',tokenId:lie.witness,factId:lie.ledgerId})).toThrow('Open a ledger');
 session=act(session,{type:'open',factId:'subject'});
 session=act(session,{type:'accuse',tokenId:lie.witness,factId:'subject'});expect(session.caught).toBe(false);expect(session.plays).toBe(6);
 session=act(session,{type:'power',factId:lie.ledgerId});
 session=act(session,{type:'accuse',tokenId:lie.witness,factId:lie.ledgerId});expect(session.caught).toBe(true);expect(session.plays).toBe(6);
});
test('exhausted players can answer and examine free records, but cannot overspend',()=>{
 const session={...start(),plays:0};
 expect(()=>act(session,{type:'ask',tokenId:draft.public.cast[0]!.tokenId})).toThrow('enough card');
 expect(()=>act(session,{type:'open',factId:'price'})).toThrow('enough card');
 expect(act(session,{type:'open',factId:'subject'}).plays).toBe(0);
 expect(act(session,{type:'submit',answers:draft.private.key.answers}).submitted).not.toBe(null);
});
test('submission requires exactly three valid options, scores on the server and reveals a verifiable key only after close',()=>{
 expect(()=>act(start(),{type:'submit',answers:{}})).toThrow('valid answer');
 expect(()=>act(start(),{type:'submit',answers:{...draft.private.key.answers,extra:'bad'}})).toThrow('valid answer');
 const session=act(start(),{type:'submit',answers:draft.private.key.answers}),view=viewSession(draft,session),result=view.result!;
 expect(result.score).toBe(430);expect(result.grade).toBe('B');expect(result.questions.every(item=>item.correct)).toBe(true);
 expect(answerHash(draft.public.id,result.verification.key!,result.verification.salt!)).toBe(draft.public.answerHash);
 expect(()=>act(session,{type:'open',factId:'price'})).toThrow('already closed');
});
test('starter groups follow real traits, excluding shifty Eyes from Empath',()=>{
 const meta=(eyes:string):Metadata=>({name:'CHOG',attributes:[{trait_type:'Eyes',value:eyes}]});
 const partners=starterPartners(new Map([[1,meta('Side Eye')],[2,meta('fire laser')],[3,meta('Anime Glass')],[4,meta('Happy')]]));
 expect(partners.map(item=>[item.tokenId,item.power])).toEqual([[2,'XRAY'],[3,'ANALYST'],[4,'EMPATH']]);
 expect(()=>starterPartners(new Map())).toThrow('Missing source-backed');
});
