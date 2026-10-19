import {mkdir,copyFile,writeFile,link} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {loadGame} from '../apps/api/src/game.mts';
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'runs/game-preview/web');
const data=await loadGame(root);
const ids=new Set(data.allPartners.map(item=>item.tokenId));
await mkdir(join(output,'art'),{recursive:true});
for(const file of ['index.html','app.js','style.css'])await copyFile(join(root,'apps/web',file),join(output,file));
for(const id of ids){try{await link(join(root,`data/images/${id}.webp`),join(output,`art/${id}.webp`));}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
for(const folder of ['thumbs','medium']){await mkdir(join(output,folder),{recursive:true});for(const id of ids){try{await link(join(root,`runs/art/${folder}/${id}.webp`),join(output,folder,`${id}.webp`));}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}}
const report={preparedAt:new Date().toISOString(),files:['index.html','app.js','style.css'],portraits:ids.size,privateArchiveCopied:false};
await writeFile(join(root,'runs/game-preview/web-manifest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
