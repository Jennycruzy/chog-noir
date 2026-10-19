import {fileURLToPath} from 'node:url';
import {cleanupGame} from '../packages/game/src/cleanup.mts';
const report=await cleanupGame(fileURLToPath(new URL('../',import.meta.url)));
console.log(JSON.stringify({at:new Date().toISOString(),...report}));
if(report.errors)process.exitCode=1;
