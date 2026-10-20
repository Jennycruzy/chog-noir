import {privateOutput} from './private-output.mts';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {loadGame,gameServer} from '../apps/api/src/game.mts';
const keyboardOnly=process.env.CHOG_BROWSER_KEYBOARD_ONLY==='true';
const root=fileURLToPath(new URL('../',import.meta.url)),output=await privateOutput(keyboardOnly?'checks/browser-keyboard':'checks/browser');
await mkdir(output,{recursive:true});
const data=await loadGame(root),temporary=await mkdtemp(join(tmpdir(),'chog-browser-'));
const game=gameServer({root:temporary,assetsRoot:root,...data,secure:false});
const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')||req.url==='/health'){game.emit('request',req,res);return;}
 const path=req.url.split('?')[0],file=(path==='/'||/^\/(verify|archive|partners|casebook|report|scam-desk|how|about|arc|breaking)$/.test(path)||/^\/chog\/\d+$/.test(path))?'apps/web/index.html':path==='/app.js'?'apps/web/app.js':path==='/style.css'?'apps/web/style.css':/^\/(art|medium|thumbs)\/\d+\.webp$/.test(path)?(path.startsWith('/art/')?`data/images/${path.split('/').at(-1)}`:`runs/art${path}`):null;
 if(!file){res.writeHead(404);res.end();return;}
 try{const bytes=await readFile(join(root,file));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'text/html','content-security-policy':csp});res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.CHOG_BROWSER??'/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(temporary,'chrome')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;
try{
 const endpoint=await new Promise((resolve,reject)=>{
  let text='';const timer=setTimeout(()=>reject(new Error('Chromium startup timed out')),120000);
  chrome.once('error',error=>{clearTimeout(timer);reject(error);});
  chrome.stderr.on('data',chunk=>{text+=chunk;const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  chrome.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chromium exited before connection: ${code}`));});
 });
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 let id=0;const pending=new Map(),exceptions=[];
 socket.on('message',bytes=>{const message=JSON.parse(String(bytes));if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.text);});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(new Error(`Browser call timed out: ${method}`));},90000);pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
 const send=(method,params)=>call(method,params,sessionId);
 await send('Runtime.enable');await send('Page.enable');
 const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description??value.exceptionDetails.text);return value.result.value;};
 const until=async(expression,label)=>{const start=Date.now();while(Date.now()-start<90000){if(await evaluate(expression))return;await pause(300);}throw new Error(`Browser condition timed out: ${label}; ${await evaluate("JSON.stringify({notice:document.querySelector('#notice')?.textContent,heading:document.querySelector('h1')?.textContent,modal:document.querySelector('#modal')?.open})")}`);};
 const key=async value=>{const keyCode={Enter:13,Tab:9,ArrowDown:40,ArrowRight:39,Home:36,' ':32}[value];await send('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:value===' '?'Space':value,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode,...(value==='Enter'?{text:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:value===' '?'Space':value,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});};
 const keyboardFocus=async selector=>{for(let attempt=0;attempt<150;attempt++){if(await evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`))return;await key('Tab');}throw new Error('Keyboard could not reach '+selector);};
 const keyboardActivate=async selector=>{await keyboardFocus(selector);await key('Enter');};
 const click=async selector=>{await until(`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`,'enabled '+selector);if(keyboardOnly)await keyboardActivate(selector);else await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
 const selectValue=async(selector,value)=>{if(!keyboardOnly)return evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);await keyboardFocus(selector);await key('Home');const index=await evaluate(`[...document.querySelector(${JSON.stringify(selector)}).options].findIndex(option=>option.value===${JSON.stringify(value)})`);assert.ok(index>=0);for(let i=0;i<index;i++)await key('ArrowDown');assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),value);};
 const fill=async(selector,value)=>{if(!keyboardOnly)return evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);await keyboardFocus(selector);await send('Input.insertText',{text:value});};
 const screenshot=async name=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output,name),Buffer.from(data,'base64'));};
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin});await until("document.querySelector('.hero')",'landing page');
 await until("[...document.images].filter(i=>!i.loading||i.loading!=='lazy').every(i=>i.complete&&i.naturalWidth>0)",'landing portraits');
 await screenshot('desktop-files.png');
 const caseId=await evaluate("document.querySelector('button[data-case]').dataset.case"),draft=data.cases.find(item=>item.public.id===caseId),lie=draft.private.key.lie;
 await keyboardActivate('button[data-case]');await until("document.querySelector('#modal').open",'partner dialog');const xrayPartner=await evaluate("[...document.querySelectorAll('[data-partner]')].find(button=>button.querySelector('small').textContent==='X-ray')?.dataset.partner");assert.ok(xrayPartner);await keyboardActivate(`[data-partner="${xrayPartner}"]`);
 await until("document.querySelector('.witnesses')",'interrogation');
 await click(`[data-witness="${lie.witness}"]`);await click(`[data-card="${lie.card}"]`);await click('[data-action="ask"]');
 await until(`document.querySelector('blockquote')?.textContent.includes(${JSON.stringify(lie.claim)})`,'testimony');
 const wrongProof=draft.public.ledger.find(item=>!item.sealed&&item.id!==lie.ledgerId);assert.ok(wrongProof);
 await click(`[data-open="${wrongProof.id}"]`);await until("document.querySelector('.proof-open')",'examined record');
 const playsBefore=await evaluate("Number(document.querySelector('.plays').firstChild.textContent.trim())");
 await click(`[data-accuse="${lie.witness}"]`);await until("document.querySelector('#proof')",'wrong proof chooser');
 await selectValue('#proof',wrongProof.id);await click('[data-confirm-accuse]');
 await until("document.querySelector('.testimony .closed-note')",'wrong accusation feedback');assert.equal(await evaluate("Number(document.querySelector('.plays').firstChild.textContent.trim())"),playsBefore-1);
 await click(`[data-power="${lie.ledgerId}"]`);await until("document.querySelectorAll('.proof-open').length===2",'opened evidence');
 await click(`[data-accuse="${lie.witness}"]`);await until("document.querySelector('#modal').open&&document.querySelector('#proof')",'proof chooser');
 await selectValue('#proof',lie.ledgerId);await click('[data-confirm-accuse]');
 await until("document.querySelector('.caught')",'lie caught');
 await screenshot('desktop-room.png');
 await send('Page.reload');await until("document.querySelector('.caught')",'refresh restores caught lie');
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
 await screenshot('mobile-room.png');
 assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Room overflows 360px viewport');
 await click('[data-action="questions"]');await until("document.querySelector('#answers')",'case questions');
 await screenshot('mobile-questions.png');
 for(const [questionId,answerId] of Object.entries(draft.private.key.answers)){
  if(keyboardOnly){await keyboardFocus(`input[name="${questionId}"]`);await key(' ');for(let attempt=0;attempt<4&&await evaluate('document.activeElement.value')!==answerId;attempt++)await key('ArrowRight');assert.equal(await evaluate('document.activeElement.value'),answerId);}
  else await evaluate(`(()=>{const input=document.querySelector('input[name="${questionId}"][value="${answerId}"]');input.click();input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 }
 await click('#submit-case');await until("document.querySelector('.grade')",'scored reveal');
 assert.equal(await evaluate("document.querySelector('.grade').textContent"),'A');
 assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Reveal overflows 360px viewport');
 await screenshot('mobile-reveal.png');
 const downloads=[];
 for(const [path,width,height] of [['/api/session/share',1200,630],['/api/session/comic',1080,1350],['/api/session/comic?format=landscape',1600,900]]){
  const result=await evaluate(`(async()=>{const response=await fetch(${JSON.stringify(path)}),bytes=await response.arrayBuffer(),view=new DataView(bytes);return {status:response.status,type:response.headers.get('content-type'),disposition:response.headers.get('content-disposition'),bytes:bytes.byteLength,width:view.getUint32(16),height:view.getUint32(20)};})()`);
  assert.equal(result.status,200);assert.equal(result.type,'image/png');assert.ok(result.disposition.startsWith('attachment'));assert.equal(result.width,width);assert.equal(result.height,height);if(path.endsWith('/share'))assert.ok(result.bytes<=300000);downloads.push({path,...result});
 }
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.ok(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"));
 await click('[data-nav="casebook"]');await until("document.querySelector('.record')",'casebook');
 await click('[data-nav="cases"]');await until("document.querySelector('.case-grid')",'case drawer navigation after mutations');
 assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Case drawer overflows 360px viewport');
 await screenshot('mobile-files.png');
 await click('[data-nav="partners"]');await until("document.querySelector('[data-chog]')",'partner collection');
 assert.ok((await evaluate("document.querySelector('.eyebrow').textContent")).includes('1,969'));
 const profileId=await evaluate("document.querySelector('[data-chog]').dataset.chog");await click('[data-chog]');await until("document.querySelector('.profile-head')",'Chog profile');
 assert.equal(await evaluate('location.pathname'),'/chog/'+profileId);
 await send('Page.reload');await until("document.querySelector('.profile-head')",'direct profile reload');
 await click('[data-nav="cases"]');await until("document.querySelector('.desk-nav')",'home before report');await click('[data-nav="report"]');await until("document.querySelector('#report-date')",'precinct report');
 await click('[data-nav="cases"]');await until("document.querySelector('.desk-nav')",'home before desk');await click('[data-nav="desk"]');await until("document.querySelector('#desk-search')",'Scam Desk');
 const auditedWallet=data.context.desk?.findings.find(item=>item.result.status==='SYNTHETIC_RECORD')?.result.sender;assert.ok(auditedWallet,'Saved proof records must be available for this acceptance run');
 await fill('#desk-search input',auditedWallet);await click('#desk-search button');await until("document.querySelector('.truth')",'proof-backed desk findings');
 await click('[data-nav="cases"]');await until("document.querySelector('.desk-nav')",'home before verify');await click('[data-nav="verify"]');await until("document.querySelector('#verify-case')",'verification page');
 await fill('#verify-case input',caseId);await click('#verify-case button');await until("document.querySelector('.helper b')?.textContent==='LOCAL_ONLY'",'honest archive verification');
 assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Utility pages overflow 360px viewport');
 assert.deepEqual(exceptions,[],'Browser raised JavaScript errors');
 const report={checkedAt:new Date().toISOString(),status:'PASS',keyboardOnly,browser:'Chromium 1234 cached on VPS',caseId,widths:[1440,360],downloads,checks:['keyboard landing and partner selection','portrait, landscape and share downloads','reduced-motion preference','landing and original artwork','partner selection','question witness','free partner unseal','wrong accusation deducts one play','evidence-backed lie accusation','refresh resumes caught lie','answer three questions','server-scored A reveal','browser casebook','partner collection and profile reload','precinct report','proof-backed Scam Desk','honest archive verification','navigation after mutations','no horizontal overflow at 360px','no JavaScript exceptions'],screenshots:['desktop-files.png','desktop-room.png','mobile-room.png','mobile-questions.png','mobile-reveal.png','mobile-files.png']};
 await writeFile(await privateOutput(keyboardOnly?'checks/game-preview-browser-keyboard.json':'checks/game-preview-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
 socket?.close();chrome.kill('SIGTERM');
 await new Promise(resolve=>server.close(()=>resolve()));
 await pause(1000);await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
