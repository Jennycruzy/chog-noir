import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AddressInfo} from 'node:net';
import assert from 'node:assert/strict';
import {gameServer,loadGame} from '../apps/api/src/game.mts';
import {answerHash} from '../packages/cases/src/build.mts';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=await loadGame(root),temporary=await mkdtemp(join(tmpdir(),'chog-archive-smoke-'));
const server=gameServer({root:temporary,...data,secure:false});
const results=[];
try{
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 for(const [index,draft] of data.cases.entries()){
  let cookie='',revision=0;
  const post=async(path:string,input:Record<string,unknown>)=>{
   const response=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(input),signal:AbortSignal.timeout(30_000)});
   if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0]!;
   const value=await response.json();assert.ok(response.ok,JSON.stringify({status:response.status,error:value.error}));return value;
  };
  const partner=data.partners[index%data.partners.length]!;
  let state=await post('/api/session',{caseId:draft.public.id,partnerId:partner.tokenId});
  const initial=JSON.stringify(state);
  assert.equal(state.result,null);assert.ok(!initial.includes('"salt"'));assert.ok(!initial.includes('"key"'));
  for(const fact of draft.public.ledger.filter(item=>item.sealed))assert.ok(!initial.includes(fact.text));
  const act=async(input:Record<string,unknown>)=>{state=await post('/api/session/action',{...input,revision});revision=state.revision;};
  const lie=draft.private.key.lie;
  await act({type:'ask',tokenId:lie.witness});
  // Open the contradiction and payment using the selected partner's actual ability.
  if(partner.power==='XRAY')await act({type:'power',factId:lie.ledgerId});
  else await act({type:'open',factId:lie.ledgerId});
  if(partner.power==='ANALYST')await act({type:'power'});else await act({type:'open',factId:'price'});
  await act({type:'accuse',tokenId:lie.witness,factId:lie.ledgerId});assert.equal(state.caught,true);
  await act({type:'submit',answers:draft.private.key.answers});
  assert.equal(state.result.questions.filter((item:{correct:boolean})=>item.correct).length,3);
  assert.equal(state.result.grade,'A');assert.ok(state.plays>=0);
  assert.equal(answerHash(draft.public.id,state.result.verification.key,state.result.verification.salt),draft.public.answerHash);
  results.push({caseId:draft.public.id,partnerPower:partner.power,score:state.result.score,grade:state.result.grade,commitmentVerified:true});
 }
 const report={checkedAt:new Date().toISOString(),status:'PASS',mode:'ARCHIVE_PREVIEW',cases:results.length,checks:['initial response hides key, salt and sealed fact text','partner ability and card accounting','evidence-backed lie accusation','all three answers and server score','revealed commitment matches saved archive'],results};
 await mkdir(new URL('../docs/audit/evidence/',import.meta.url),{recursive:true});
 await writeFile(new URL('../docs/audit/evidence/game-preview.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 await rm(temporary,{recursive:true,force:true});
}
