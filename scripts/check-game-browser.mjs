import {privateOutput} from './private-output.mts';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {planFor} from '../packages/cases/src/puzzle.mts';
import {fixtureServer,puzzle,holder,training} from '../apps/api/test/fixture.mts';

// Plays the real site in headless Chromium: the Rookie path on a 360 px touch phone, the holder path on a desktop, and
// Case #0. With CHOG_BROWSER_KEYBOARD_ONLY=true every holder action is done with Tab and Enter.
const keyboardOnly=process.env.CHOG_BROWSER_KEYBOARD_ONLY==='true';
const output=await privateOutput(keyboardOnly?'checks/browser-v2-keyboard':'checks/browser-v2');await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'chog-browser-')),fixture=await fixtureServer(join(temporary,'state'),{web:true}),{origin}=fixture;
const chrome=spawn(process.env.CHOG_BROWSER??'/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows',`--user-data-dir=${join(temporary,'chrome')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;const report={keyboardOnly,paths:[]};
try{
 const endpoint=await new Promise((resolve,reject)=>{
  let text='';const timer=setTimeout(()=>reject(new Error('Chromium startup timed out')),120000);
  chrome.once('error',error=>{clearTimeout(timer);reject(error);});
  chrome.stderr.on('data',chunk=>{text+=chunk;const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  chrome.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chromium exited before connection: ${code}`));});
 });
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 let id=0;const pending=new Map(),exceptions=[];
 socket.on('message',bytes=>{const message=JSON.parse(String(bytes));if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(new Error(`Browser call timed out: ${method}`));},90000);pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params,...(sessionId?{sessionId}:{})}));});

 /** A fresh browser context per path, so cookies never leak between the visitor and the holder. */
 async function page({width,height,mobile,wallet}){
  const {browserContextId}=await call('Target.createBrowserContext');
  const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params)=>call(method,params,sessionId);
  await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:mobile?2:1,mobile});
  if(mobile)await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  // A test wallet for the holder path: it reports the real holder address and returns a signature the test verifier accepts.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__trail=[];const __fetch=window.fetch;window.fetch=async(...args)=>{const label=(args[1]?.method||'GET')+' '+String(args[0]).replace(location.origin,'')+(args[1]?.body?' '+String(args[1].body).slice(0,60):'');window.__trail.push('→ '+label);try{const response=await __fetch(...args);window.__trail.push('← '+response.status+' '+label);return response;}catch(error){window.__trail.push('✗ '+label+' '+error);throw error;}};addEventListener('error',event=>window.__trail.push('error '+event.message));addEventListener('unhandledrejection',event=>window.__trail.push('rejection '+String(event.reason)));"});
  if(mobile)await send('Page.addScriptToEvaluateOnNewDocument',{source:"addEventListener('touchend',()=>{window.__touched=true;},{capture:true,passive:true});addEventListener('click',()=>{window.__clicked=true;},{capture:true});"});
  if(wallet)await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.ethereum={request:async({method})=>method==='eth_requestAccounts'?[${JSON.stringify(wallet)}]:method==='personal_sign'?'0x'+'12'.repeat(65):null};`});
  const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description??value.exceptionDetails.text);return value.result.value;};
  const until=async(expression,label)=>{const start=Date.now();while(Date.now()-start<90000){if(await evaluate(expression))return;await pause(250);}throw new Error(`Browser condition timed out: ${label}; notice=${await evaluate("document.querySelector('#notice')?.textContent")}; path=${await evaluate('location.pathname')}; last requests=${await evaluate("JSON.stringify((window.__trail||[]).slice(-8))")}`);};
  const key=async value=>{const code={Enter:13,Tab:9}[value];await send('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:value,windowsVirtualKeyCode:code,nativeVirtualKeyCode:code,...(value==='Enter'?{text:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:value,windowsVirtualKeyCode:code,nativeVirtualKeyCode:code});};
  const labelled=async(selector,text)=>{await until(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(item=>item.textContent.includes(${JSON.stringify(text)})||item.getAttribute('aria-label')?.includes(${JSON.stringify(text)}));if(!node)return false;node.dataset.check=${JSON.stringify(text)};return true;})()`,'control '+text);return `[data-check=${JSON.stringify(text)}]`;};
  const ready=selector=>until(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});return !!node&&!node.disabled&&node.getBoundingClientRect().height>0;})()`,'ready '+selector);
  async function activate(selector){
   if(process.env.CHOG_BROWSER_TRACE)console.error('activate',selector);
   await ready(selector);
   if(keyboardOnly&&!mobile){
    await evaluate('document.activeElement?.blur();document.body.focus()');
    for(let step=0;step<400;step++){if(await evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`)){await key('Enter');return;}await key('Tab');}
    throw new Error('Keyboard could not reach '+selector);
   }
   if(mobile){
    // Tap only once the point is on the target: typed statements can still be growing the layout.
    let box=null;
    for(let attempt=0;attempt<40&&!box;attempt++){
     box=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const rect=node.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;const hit=document.elementFromPoint(x,y);return hit&&(hit===node||node.contains(hit))&&y>0&&y<innerHeight?{x,y}:null;})()`);
     if(!box)await pause(250);
    }
    if(!box)throw new Error('Target never became tappable: '+selector+' '+await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),rect=node.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);const owner=hit?.closest('button'),r=x=>{const b=x.getBoundingClientRect();return [Math.round(b.top),Math.round(b.bottom),Math.round(b.left),Math.round(b.right)];};return JSON.stringify({target:r(node),covering:owner?r(owner):null,coverStyle:owner?getComputedStyle(owner).position+' '+getComputedStyle(owner).transform:null,parentStyle:getComputedStyle(node.parentElement).display,section:node.parentElement.className});})()`));
    // On a starved CPU the gap between touch start and end can pass the long-press threshold, and a long press makes no click.
    // A tap is retried only when no click followed it, so an action is never sent twice.
    for(let attempt=0;attempt<3;attempt++){
     await evaluate('window.__touched=false;window.__clicked=false');
     await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[box]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     if(!await evaluate('window.__touched'))throw new Error('No touch event reached the page');
     for(let wait=0;wait<20&&!await evaluate('window.__clicked');wait++)await pause(100);
     if(await evaluate('window.__clicked'))return;
    }
    throw new Error('A tap produced no click: '+selector);
   }
   await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  // A full-page capture resizes an emulated phone viewport and can strand later touch input, so phones capture the viewport.
  const screenshot=async name=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:!mobile});await writeFile(join(output,name),Buffer.from(data,'base64'));};
  const noSideScroll=async()=>assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'the page scrolls sideways');
  return {send,evaluate,until,activate,labelled,screenshot,noSideScroll,go:async path=>{await send('Page.navigate',{url:origin+path});await until('document.readyState==="complete"','load '+path);}};
 }
 /** Works the case through the room exactly as a player would: press, open, select a statement, present a receipt, solve. */
 async function work(p,plan,prefix){
  for(const lie of plan.lies){
   const statement=plan.statements.find(row=>row.id===lie.statementId);
   if(statement.slot==='followup'&&!await p.evaluate(`!!document.querySelector('[data-statement="${lie.statementId}"]')`))await p.activate(`[data-press="${lie.witness}"]`);
   await p.until(`!!document.querySelector('[data-statement="${lie.statementId}"]')`,'statement '+lie.statementId);
   if(await p.evaluate(`!!document.querySelector('[data-open="${lie.receiptId}"]')`)){await p.activate(`[data-open="${lie.receiptId}"]`);await p.until(`!document.querySelector('[data-open="${lie.receiptId}"]')`,'opened '+lie.receiptId);}
   await p.activate(`[data-statement="${lie.statementId}"]`);await p.until(`document.querySelector('[data-statement="${lie.statementId}"]').getAttribute('aria-pressed')==='true'`,'selected statement');
   await p.activate(`button[data-receipt="${lie.receiptId}"]`);
   await p.until(`document.querySelector('[data-statement="${lie.statementId}"]')?.classList.contains('caught')`,'CAUGHT '+lie.id);
   if(lie.id==='A')await p.screenshot(prefix+'-caught.png');
  }
  await p.activate(await p.labelled('button','Solve the case'));
  for(const blank of puzzle.file.blanks){await p.activate(`[data-blank="${blank.id}"]`);await p.activate(`[data-tile="${puzzle.key.answers[blank.id]}"]`);}
  await p.screenshot(prefix+'-solve.png');
  await p.activate(await p.labelled('button','Submit solution'));
  await p.until(`[...document.querySelectorAll('h2')].some(node=>node.textContent==='What really happened')`,'reveal');
  const panels=await p.evaluate(`[...document.querySelectorAll('.panel')].map(node=>({label:node.querySelector('.label')?.textContent,statement:node.querySelector('.false')?.textContent,receipt:node.querySelector('.type')?.textContent}))`);
  assert.equal(panels.length,plan.lies.length);
  for(const panel of panels){assert.equal(panel.label,'CAUGHT — false statement');assert.ok(panel.statement&&panel.receipt,'every false statement shares its panel with the label and receipt');}
  return (await p.evaluate("document.querySelector('pre.share').textContent")).split('\n');
 }

 // 1. Rookie desk, logged out, no wallet, 360 px touch phone.
 {
  const p=await page({width:360,height:780,mobile:true});
  await p.go('/');await p.until("!!document.querySelector('.hero .line')",'front door');
  assert.equal(await p.evaluate("document.querySelector('.hero .line').textContent"),'Every night something real happens to Chogs on Monad. Every morning your Chog takes the case. One witness is lying. The chain never does.');
  await p.until("!!document.querySelector('.replay .replay-stamp')",'REPLAY panel');assert.equal(await p.evaluate("document.querySelector('.replay .replay-label').textContent"),'REPLAY');
  await p.noSideScroll();await p.screenshot('phone-front-door.png');
  await p.activate(await p.labelled('button','Play as a rookie'));
  await p.activate(await p.labelled('button','Skip to today’s case'));
  await p.until("!!document.querySelector('.room .rule')",'room');
  assert.equal(await p.evaluate("document.querySelector('.room .rule').textContent"),puzzle.file.ruleLine);
  assert.ok(await p.evaluate("document.querySelector('.rookie-desk')?.textContent==='ROOKIE'"));
  await p.noSideScroll();await p.screenshot('phone-room.png');
  const grid=await work(p,planFor(puzzle,null),'phone');
  assert.equal(grid[1],'ROOKIE DESK');assert.match(grid[0],/^CHOG NOIR #1 · /);
  assert.ok(await p.evaluate("document.querySelector('.banner')?.textContent.includes('Hold a Chog and it becomes your detective. Its career is kept on the token.')"));
  await p.noSideScroll();await p.screenshot('phone-reveal.png');
  report.paths.push({path:'rookie',viewport:'360x780 touch',grid});
 }
 // 2. Case #0 on the phone.
 {
  const p=await page({width:360,height:780,mobile:true});
  await p.go('/training');await p.until("!!document.querySelector('[data-statement]')",'training room');
  await p.activate(`[data-statement="${training.lie.statementId}"]`);await p.activate(`button[data-receipt="${training.lie.receiptId}"]`);
  await p.until("!!document.querySelector('[data-blank]')",'training solution');
  for(const blank of training.blanks){await p.activate(`[data-blank="${blank.id}"]`);await p.activate(`[data-tile="${training.answers[blank.id]}"]`);}
  await p.activate(await p.labelled('button','Submit'));await p.until("document.body.textContent.includes('Case #0 closed.')",'training closed');
  report.paths.push({path:'training',viewport:'360x780 touch'});
 }
 // 3. Holder: connect, pick the Chog, take the case, solve, record. Desktop; keyboard only when requested.
 {
  const p=await page({width:1440,height:1000,mobile:false,wallet:holder});
  await p.go('/connect');await p.activate(await p.labelled('button','Sign in'));
  await p.until("!!document.querySelector('.chog-card')",'detective list');await p.screenshot('desktop-pick.png');
  const name=(await import('../apps/api/test/fixture.mts')).metadata.get(11).name;
  await p.activate(await p.labelled('.chog-card',name));
  await p.activate(await p.labelled('button','Take the case'));await p.until("!!document.querySelector('.room .rule')",'holder room');
  await p.screenshot('desktop-room.png');
  await work(p,planFor(puzzle,11),'desktop');
  // The holder's record and streak load after the reveal is already on screen.
  await p.until("document.querySelector('pre.share')?.textContent.includes('Streak')",'holder streak');
  const grid=(await p.evaluate("document.querySelector('pre.share').textContent")).split('\n');
  assert.match(grid[1],new RegExp('^🕵️ '+name.replace(/[#]/g,'\\#')));assert.match(grid.at(-1),/^Streak 1 🔥$/);
  await p.screenshot('desktop-reveal.png');
  await p.go('/chog/11');await p.until("document.body.textContent.includes('Cases solved')",'profile');
  assert.ok(await p.evaluate("[...document.querySelectorAll('tr')].some(row=>row.textContent==='Cases solved1')"));
  await p.go('/precinct');await p.until("!!document.querySelector('.tile-card')",'precinct tile');await p.screenshot('desktop-precinct.png');
  report.paths.push({path:'holder',viewport:'1440x1000',keyboardOnly,grid});
 }
 assert.deepEqual(exceptions,[],'page errors');
 await writeFile(join(output,'report.json'),JSON.stringify({...report,checkedAt:new Date().toISOString(),status:'PASS'},null,2));
 console.log(JSON.stringify({status:'PASS',keyboardOnly,paths:report.paths.map(row=>row.path)}));
}finally{socket?.close();const exited=chrome.exitCode===null?new Promise(resolve=>chrome.once('exit',resolve)):null;chrome.kill('SIGKILL');await exited;await fixture.close();await rm(temporary,{recursive:true,force:true,maxRetries:5});}
