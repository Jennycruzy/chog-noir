import {fileURLToPath} from 'node:url';
import {cleanupGame} from '../packages/game/src/cleanup.mts';
import {RookieDesk} from '../packages/game/src/rookie.mts';
const root=fileURLToPath(new URL('../',import.meta.url));
const report=await cleanupGame(root);
const rookieExpired=await new RookieDesk({root,metadata:new Map()}).expire();
console.log(JSON.stringify({at:new Date().toISOString(),...report,rookieExpired}));
if(report.errors)process.exitCode=1;
