import sharp from 'sharp';
import {mkdir,readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicJSON} from '../packages/publishing/src/vault.mts';
const root=fileURLToPath(new URL('../',import.meta.url)),directory=join(root,'runs/art');sharp.concurrency(1);
for(const folder of ['thumbs','medium'])await mkdir(join(directory,folder),{recursive:true});
for(let id=1;id<=1969;id++){
 for(const [folder,size] of [['thumbs',256],['medium',512]] as const){
  const path=join(directory,folder,`${id}.webp`);
  try{const saved=await sharp(path).metadata();if(saved.width===size&&saved.height===size&&saved.format==='webp')continue;}catch{}
  const source=await readFile(join(root,`data/images/${id}.webp`));
  const temporary=path+'.tmp.webp';await sharp(source).resize(size,size).greyscale().linear(1.08,-5).webp({quality:78}).toFile(temporary);await rename(temporary,path);
 }
 if(id%25===0||id===1969){await atomicJSON(join(directory,'progress.json'),{updatedAt:new Date().toISOString(),completed:id,total:1969,status:id===1969?'PASS':'RUNNING',sizes:[256,512],source:'Original Chog Genesis artwork; deterministic noir treatment'});console.log(JSON.stringify({completed:id,total:1969}));}
}
