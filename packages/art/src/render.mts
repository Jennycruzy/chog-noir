import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {CaseDraft} from '../../cases/src/build.mts';
import {memoryLine} from '../../witness/src/facts.mts';
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
function lines(value:string,max:number){const result:string[]=[];let current='';for(const word of value.split(/\s+/)){if((current+' '+word).trim().length>max&&current){result.push(current);current=word;}else current=(current+' '+word).trim();}if(current)result.push(current);return result;}
function text(value:string,x:number,y:number,size=24,max=38,color='#e5dfce'){
 return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-family="DejaVu Sans Mono, monospace">${lines(value,max).map((line,index)=>`<tspan x="${x}" dy="${index===0?0:size*1.4}">${escape(line)}</tspan>`).join('')}</text>`;
}
async function portrait(root:string,id:number,width:number,height:number){
 if(!Number.isInteger(id)||id<1||id>1969)throw new Error('ART_TOKEN: Invalid token');
 const source=await readFile(join(root,`data/images/${id}.webp`));
 const image=await sharp(source).resize(width,height,{fit:'cover'}).greyscale().linear(1.12,-8).png().toBuffer();
 return `data:image/png;base64,${image.toString('base64')}`;
}
export async function comic(root:string,draft:CaseDraft,landscape=false){
 const width=landscape?1600:1080,height=landscape?900:1350,panelW=width/2,panelH=(height-50)/2;
 const lie=draft.private.key.lie,other=draft.public.cast.find(item=>item.tokenId!==lie.witness)!;
 const proof=draft.public.ledger.find(item=>item.id===lie.ledgerId)!;
 const trueLine=draft.private.facts?draft.private.facts[other.tokenId]!.cards.ARRIVAL.detail:'An arrival is recorded in the ledger.';
 const claim=draft.private.facts?memoryLine(draft,lie.witness,lie.card).line:draft.public.testimony.find(item=>item.tokenId===lie.witness)!.line;
 const panels=[{id:draft.public.subject.tokenId,label:'01 / THE SCENE',caption:`${draft.public.subject.name} changed hands on ${draft.public.occurredAt.slice(0,10)}.`},
  {id:other.tokenId,label:'02 / THE WITNESS',caption:`${other.name} ${trueLine}.`},
  {id:lie.witness,label:'03 / PLANNED LIE',caption:claim},
  {id:draft.public.subject.tokenId,label:'04 / THE RECORD',caption:proof.text}];
 const images=await Promise.all(panels.map(panel=>portrait(root,panel.id,panelW,panelH)));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111411"/>${panels.map((panel,index)=>{
  const x=index%2*panelW,y=Math.floor(index/2)*panelH,overlay=landscape?160:220;
  return `<image href="${images[index]}" x="${x+5}" y="${y+5}" width="${panelW-10}" height="${panelH-10}"/><rect x="${x+5}" y="${y+panelH-overlay}" width="${panelW-10}" height="${overlay-5}" fill="#111411" fill-opacity=".94"/>${text(panel.label,x+24,y+panelH-overlay+30,16,50,index===2?'#e69982':'#d2dd92')}${text(panel.caption,x+24,y+panelH-overlay+65,landscape?21:20,landscape?54:36)}${index===3?text(`TX ${proof.sources[0]!.tx.slice(0,12)}… / BLOCK ${proof.sources[0]!.block}`,x+24,y+panelH-17,11,75,'#b4b99f'):''}`;
 }).join('')}${text('CHOG NOIR / Original Chog Genesis art by CHOGLABS. Unofficial Chogathon entry.',20,height-18,12,140,'#9a9e8d')}</svg>`;
 return sharp(Buffer.from(svg)).png({compressionLevel:9}).toBuffer();
}
export async function shareCard(root:string,draft:CaseDraft,result:{score:number;grade:string},plays:number,initial:number,caught:boolean){
 const image=await portrait(root,draft.public.subject.tokenId,490,630);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#111411"/><image href="${image}" x="710" y="0" width="490" height="630"/><rect x="710" width="490" height="630" fill="#111411" fill-opacity=".2"/>${text('CHOG NOIR',45,70,32,40,'#d2dd92')}${text(draft.public.publication?'DAILY CASE':'ARCHIVE PRACTICE',45,115,15,55,'#9a9e8d')}${text('THE RECORD TELLS THE STORY.',45,175,20,45)}${text(`${result.score} POINTS / GRADE ${result.grade}`,45,260,34,35,'#d2dd92')}${text(caught?'LIE CAUGHT':'LIE MISSED',45,330,23,40)}${text(`${plays}/${initial} CARD PLAYS LEFT`,45,380,20,40)}${text(draft.public.subject.name,45,450,28,35)}${text('Chog Genesis by CHOGLABS. Unofficial Chogathon entry.',45,590,12,83,'#9a9e8d')}</svg>`;
 for(const colours of [128,64,32,16]){
  const png=await sharp(Buffer.from(svg)).png({palette:true,colours,dither:.4,compressionLevel:9}).toBuffer();if(png.length<=300_000)return png;
 }
 throw new Error('ART_SHARE_SIZE: Unable to satisfy the 300 KB share limit');
}
