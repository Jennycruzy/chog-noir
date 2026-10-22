import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import assert from 'node:assert/strict';

// Boots the real API entry point against the real runtime files and checks every public route answers as specified.
const root=fileURLToPath(new URL('../',import.meta.url));
const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['--import','tsx','apps/api/src/game.mts'],{cwd:root,env:{...process.env,PORT:String(port),BUREAU_ORIGIN:origin+'/'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
try{
 const start=Date.now();while(!output.includes('listening')){if(child.exitCode!==null||Date.now()-start>180_000)throw new Error('SMOKE_START: '+output.slice(-400));await pause(500);}
 const get=async(path:string)=>{const response=await fetch(origin+path);return {status:response.status,body:await response.json()};};
 const health=await get('/api/health');assert.equal(health.status,200);assert.equal(health.body.service,'chog-noir');
 const today=await get('/api/case/today');assert.equal(today.status,200);
 if(today.body.case){assert.match(today.body.case.ruleLine,/^(One|Two) Chogs? (is|are) lying\. Present the receipts? that proves? it\.$/);assert.equal(JSON.stringify(today.body).includes('"key"'),false);}
 const replay=await get('/api/replay');assert.equal(replay.status,200);assert.equal(replay.body.label,'REPLAY');assert.ok(replay.body.statement&&replay.body.receipt.text);
 const training=await fetch(origin+'/api/training/start',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});assert.equal(training.status,200);
 const board=await get('/api/precinct');assert.equal(board.status,200);assert.equal(JSON.stringify(board.body).includes('statementId'),false);
 const profile=await get('/api/chog/11');assert.equal(profile.status,200);assert.ok(profile.body.name.startsWith('CHOG'));
 const issues=await get('/api/issues');assert.equal(issues.status,200);
 const report=await get('/api/report');assert.ok([200,503].includes(report.status));
 console.log(JSON.stringify({status:'PASS',caseOpen:!!today.body.case,daily:health.body.daily,issues:issues.body.issues.length,owners:health.body.owners}));
}finally{child.kill('SIGTERM');}
