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
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'runs/game-preview/browser');
await mkdir(output,{recursive:true});
const data=await loadGame(root),temporary=await mkdtemp(join(tmpdir(),'chog-browser-'));
const game=gameServer({root:temporary,assetsRoot:root,...data,secure:false});
const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')||req.url==='/health'){game.emit('request',req,res);return;}
 const path=req.url.split('?')[0],file=(path==='/'||/^\/(verify|archive|partners|casebook|report|scam-desk|how|about|arc|breaking)$/.test(path)||/^\/chog\/\d+$/.test(path))?'apps/web/index.html':path==='/app.js'?'apps/web/app.js':path==='/style.css'?'apps/web/style.css':/^\/art\/\d+\.webp$/.test(path)?`data/images/${path.split('/').at(-1)}`:null;
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
 const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.text);return value.result.value;};
 const until=async(expression,label)=>{const start=Date.now();while(Date.now()-start<90000){if(await evaluate(expression))return;await pause(300);}throw new Error(`Browser condition timed out: ${label}`);};
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const screenshot=async name=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output,name),Buffer.from(data,'base64'));};
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin});await until("document.querySelector('.hero')",'landing page');
 await until("[...document.images].filter(i=>!i.loading||i.loading!=='lazy').every(i=>i.complete&&i.naturalWidth>0)",'landing portraits');
 await screenshot('desktop-files.png');
 const caseId=await evaluate("document.querySelector('button[data-case]').dataset.case"),draft=data.cases.find(item=>item.public.id===caseId),lie=draft.private.key.lie;
 await click('button[data-case]');await until("document.querySelector('#modal').open",'partner dialog');await click('[data-partner]');
 await until("document.querySelector('.witnesses')",'interrogation');
 await click(`[data-witness="${lie.witness}"]`);await click(`[data-card="${lie.card}"]`);await click('[data-action="ask"]');
 await until(`document.querySelector('blockquote')?.textContent.includes(${JSON.stringify(lie.claim)})`,'testimony');
 await click(`[data-power="${lie.ledgerId}"]`);await until("document.querySelector('.proof-open')",'opened evidence');
 await click(`[data-accuse="${lie.witness}"]`);await until("document.querySelector('#proof')",'proof chooser');
 await evaluate(`document.querySelector('#proof').value=${JSON.stringify(lie.ledgerId)}`);await click('[data-confirm-accuse]');
 await until("document.querySelector('.caught')",'lie caught');
 await screenshot('desktop-room.png');
 await send('Page.reload');await until("document.querySelector('.caught')",'refresh restores caught lie');
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
 await screenshot('mobile-room.png');
 assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Room overflows 360px viewport');
 await click('[data-action="questions"]');await until("document.querySelector('#answers')",'case questions');
 await screenshot('mobile-questions.png');
 for(const [questionId,answerId] of Object.entries(draft.private.key.answers)){
  await evaluate(`(()=>{const input=document.querySelector('input[name="${questionId}"][value="${answerId}"]');input.click();input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 }
 await click('#submit-case');await until("document.querySelector('.grade')",'scored reveal');
 assert.equal(await evaluate("document.querySelector('.grade').textContent"),'A');
 assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Reveal overflows 360px viewport');
 await screenshot('mobile-reveal.png');
 await click('[data-nav="casebook"]');await until("document.querySelector('.record')",'casebook');
 await click('[data-nav="cases"]');await until("document.querySelector('.case-grid')",'case drawer navigation after mutations');
 assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Case drawer overflows 360px viewport');
 await screenshot('mobile-files.png');
 assert.deepEqual(exceptions,[],'Browser raised JavaScript errors');
 const report={checkedAt:new Date().toISOString(),status:'PASS',browser:'Chromium 1234 cached on VPS',caseId,widths:[1440,360],checks:['landing and original artwork','partner selection','question witness','free partner unseal','evidence-backed lie accusation','refresh resumes caught lie','answer three questions','server-scored A reveal','browser casebook','navigation after mutations','no horizontal overflow at 360px','no JavaScript exceptions'],screenshots:['desktop-files.png','desktop-room.png','mobile-room.png','mobile-questions.png','mobile-reveal.png','mobile-files.png']};
 await writeFile(join(root,'docs/audit/evidence/game-preview-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
 socket?.close();chrome.kill('SIGTERM');
 await new Promise(resolve=>server.close(()=>resolve()));
 await pause(1000);await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
