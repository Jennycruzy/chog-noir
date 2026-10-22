import {mkdir,copyFile,writeFile,link} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
// Public-only static bundle: the page, script, style and the art of every Chog. No case, key or metadata file is copied.
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'runs/game-preview/web');
const ids=Array.from({length:1969},(_,index)=>index+1);
for(const folder of ['art','thumbs','medium'])await mkdir(join(output,folder),{recursive:true});
for(const file of ['index.html','app.js','style.css'])await copyFile(join(root,'apps/web',file),join(output,file));
const place=async(from:string,to:string)=>{try{await link(from,to);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}};
for(const id of ids){await place(join(root,`data/images/${id}.webp`),join(output,`art/${id}.webp`));for(const folder of ['thumbs','medium'])await place(join(root,`runs/art/${folder}/${id}.webp`),join(output,folder,`${id}.webp`));}
const report={preparedAt:new Date().toISOString(),files:['index.html','app.js','style.css'],portraits:ids.length,privateArchiveCopied:false};
await writeFile(join(root,'runs/game-preview/web-manifest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
