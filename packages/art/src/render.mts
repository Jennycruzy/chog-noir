import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {caseReveal} from '../../game/src/puzzle-session.mts';
import type {PuzzleCase} from '../../cases/src/puzzle.mts';

const INK='#0E0E10',PAPER='#F2EDE4',LAMP='#F5C451',ALARM='#E5484D',FOG='#8A8A94',LIMIT=400_000;
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
function wrap(value:string,max:number){const result:string[]=[];let current='';for(const word of value.split(/\s+/)){if((current+' '+word).trim().length>max&&current){result.push(current);current=word;}else current=(current+' '+word).trim();}if(current)result.push(current);return result;}
/** Wrapped text; returns the markup and the height it used, so callers can stack blocks without overlap. */
function text(value:string,x:number,y:number,options:{size?:number;max?:number;color?:string;weight?:string;strike?:boolean}={}){
 const {size=24,max=38,color=PAPER,weight='normal',strike=false}=options,rows=wrap(value,max),lead=size*1.35;
 const markup=`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" font-family="DejaVu Sans Mono, monospace"${strike?` text-decoration="line-through"`:''}>${rows.map((row,index)=>`<tspan x="${x}" dy="${index===0?0:lead}">${escape(row)}</tspan>`).join('')}</text>`;
 return {markup,height:rows.length*lead};
}
async function portrait(root:string,id:number,width:number,height:number){
 if(!Number.isInteger(id)||id<1||id>1969)throw new Error('ART_TOKEN: Invalid token');
 const image=await sharp(await readFile(join(root,`data/images/${id}.webp`))).resize(Math.round(width),Math.round(height),{fit:'cover'}).greyscale().linear(1.12,-8).png().toBuffer();
 return `data:image/png;base64,${image.toString('base64')}`;
}
async function fit(svg:string,code:string){
 for(const colours of [256,128,64,32,16]){const png=await sharp(Buffer.from(svg)).png({palette:true,colours,dither:.5,compressionLevel:9}).toBuffer();if(png.length<=LIMIT)return png;}
 throw new Error(code+': Unable to satisfy the 400 KB image limit');
}

/**
 * Chog Noir Issue #N, four panels from real art. Panel 3 is the only place a false statement appears: the struck
 * statement, the exact CAUGHT label and the real breaking receipt are drawn together as one panel. Panel 4 is facts only.
 */
export function issuePanels(puzzle:PuzzleCase,issue:{number:number;openTx:string;closeTx:string}){
 const reveal=caseReveal(puzzle),lie=reveal.panels[0]!,subject=puzzle.file.subject,witnesses=puzzle.file.cast.filter(row=>row.tokenId!==subject.tokenId);
 return [
  {art:subject.tokenId,label:'01 · THE SCENE',blocks:[{value:`Issue #${issue.number} · ${puzzle.file.title}`,color:LAMP,weight:'bold'},{value:puzzle.file.setup}]},
  {art:witnesses[0]?.tokenId??subject.tokenId,label:'02 · THE WITNESSES',blocks:[{value:puzzle.file.cast.map(row=>`${row.name}, ${row.nickname}`).join(' · ')}]},
  {art:lie.witness,label:'03 · CAUGHT',blocks:[{value:lie.statement,strike:true},{value:lie.label,color:ALARM,weight:'bold'},{value:lie.receipt.text,color:LAMP},...(reveal.panels.length>1?[{value:`+${reveal.panels.length-1} more lie${reveal.panels.length>2?'s':''} caught`,color:FOG}]:[])]},
  {art:subject.tokenId,label:'04 · WHAT REALLY HAPPENED',blocks:[...reveal.truth.slice(0,2).map(row=>({value:row.text})),{value:`Locked ${issue.openTx.slice(0,10)}… · revealed ${issue.closeTx.slice(0,10)}…`,color:FOG}]},
 ];
}
export async function issueImage(root:string,puzzle:PuzzleCase,issue:{number:number;openTx:string;closeTx:string},landscape=false){
 const width=landscape?1600:1080,height=landscape?900:1350,footer=44,panelW=width/2,panelH=(height-footer)/2,column=landscape?44:30,panels=issuePanels(puzzle,issue);
 const images=await Promise.all(panels.map(panel=>portrait(root,panel.art,panelW-12,panelH-12)));
 const body=panels.map((panel,index)=>{
  const x=index%2*panelW,y=Math.floor(index/2)*panelH,overlay=landscape?panelH*.62:panelH*.58;
  // Shrink the type until every block sits inside the frame; a comparison is never clipped.
  let markup='';
  for(const size of landscape?[18,16,14]:[17,15,13]){
   let cursor=y+panelH-overlay+34;markup=text(panel.label,x+22,cursor,{size:16,max:60,color:index===2?ALARM:LAMP,weight:'bold'}).markup;cursor+=34;
   const columns=Math.floor(column*17/size);
   for(const block of panel.blocks){const piece=text(block.value,x+22,cursor,{size,max:columns,...block});markup+=piece.markup;cursor+=piece.height+10;}
   if(cursor<=y+panelH-12)break;
   if(size===(landscape?14:13))throw new Error('ART_PANEL_OVERFLOW: A panel does not fit its frame');
  }
  // Each panel, including the CAUGHT comparison, is one framed unit; nothing in panel 3 can be cropped apart.
  return `<g><image href="${images[index]}" x="${x+6}" y="${y+6}" width="${panelW-12}" height="${panelH-12}" preserveAspectRatio="xMidYMid slice"/><rect x="${x+6}" y="${y+panelH-overlay}" width="${panelW-12}" height="${overlay-6}" fill="${INK}" fill-opacity=".93"/><rect x="${x+6}" y="${y+6}" width="${panelW-12}" height="${panelH-12}" fill="none" stroke="${index===2?ALARM:PAPER}" stroke-width="${index===2?4:2}"/>${markup}</g>`;
 }).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${INK}"/>${body}${text('CHOG NOIR · Original Chog Genesis art by CHOGLABS. Unofficial Chogathon entry.',20,height-16,{size:13,max:140,color:FOG}).markup}</svg>`;
 return fit(svg,'ART_ISSUE_SIZE');
}

export interface ShareFacts {number:number;weekday:string;detective:string;liesCaught:number;lies:number;solved:boolean;questionsLeft:number;streak:number|null;subject:number}
/** The 1200×630 share image: the same facts as the share grid and nothing that reveals the answer. */
export async function shareImage(root:string,facts:ShareFacts){
 const image=await portrait(root,facts.subject,490,630);
 const lines=[text('CHOG NOIR',48,82,{size:44,max:30,color:LAMP,weight:'bold'}),text(`#${facts.number} · ${facts.weekday}`,48,138,{size:26,max:40}),
  text(facts.detective,48,210,{size:24,max:38}),text(`Lies ${'■'.repeat(facts.liesCaught)}${'□'.repeat(Math.max(0,facts.lies-facts.liesCaught))}  Solution ${facts.solved?'✓':'✗'}`,48,290,{size:28,max:40,color:facts.liesCaught?ALARM:PAPER}),
  text(`Questions left ${facts.questionsLeft}`,48,350,{size:24,max:40}),...(facts.streak!==null?[text(`Streak ${facts.streak}`,48,405,{size:24,max:40,color:LAMP})]:[]),
  text('Chog Genesis by CHOGLABS. Unofficial Chogathon entry.',48,594,{size:13,max:83,color:FOG})];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${INK}"/><image href="${image}" x="710" y="0" width="490" height="630"/><rect x="710" width="490" height="630" fill="${INK}" fill-opacity=".15"/>${lines.map(row=>row.markup).join('')}</svg>`;
 return fit(svg,'ART_SHARE_SIZE');
}
