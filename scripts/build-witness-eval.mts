import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { formatEther } from 'viem';
import { cards, voices, templateLine, type WitnessInput } from '../packages/witness/src/lines.mts';
import type { Classification } from '../packages/core/src/chain.mts';
import type { EnrichedEvent } from '../packages/core/src/enrich.mts';
const root = new URL('../', import.meta.url);
const parsed = JSON.parse(await readFile(new URL('runs/classification/enriched.json', root), 'utf8')) as { events: EnrichedEvent[] };
const history = JSON.parse(await readFile(new URL('data/related/history.json', root), 'utf8')) as { data: { blocks: { number: number; timestamp: number }[] } };
const events = parsed.events.map(row => row.event);
const times = new Map(history.data.blocks.map(block => [block.number, block.timestamp]));
const sales = parsed.events.filter(row => row.event.class === 'SALE' && row.event.price?.status === 'EXACT' && row.event.price.grossWei !== null && row.holdSeconds !== null);
const short = (address: string) => `${address.slice(0,6)}…${address.slice(-4)}`;
const source = (event: Classification) => ({ tx: event.tx, block: event.block, logIndex: event.logIndex });
const rows: WitnessInput[] = [];
const crude = /boob|milf|retard|horny|boner|\bbbc\b|thots|buttcoin/i;
const clean = (attribute: {trait_type:string;value:string}) => crude.test(attribute.value) ? (attribute.trait_type === 'Head' ? 'slogan cap' : 'novelty accessory') : attribute.value;
for (let repeat = 0; repeat < 4; repeat++) for (const card of cards) for (const voice of voices) for (const isLie of [false,true]) {
  const row = sales[(repeat * 80 + rows.length) % sales.length]!;
  const event = row.event;
  const time = times.get(event.block);
  if (!time) throw new Error('WITNESS_SOURCE: Missing sale time');
  const metadata = JSON.parse(await readFile(new URL(`data/metadata/${event.tokenId}.json`,root),'utf8')).metadata;
  const day = new Date(time * 1000).toISOString().slice(0,10);
  const prior = events.filter(item => item.block < event.block || item.block === event.block && item.logIndex <= event.logIndex);
  const tokenMoves = prior.filter(item => item.tokenId === event.tokenId);
  let facts: string[], sources = [source(event)];
  switch(card) {
    case 'LAST_SALE': facts = [metadata.name, `${formatEther(BigInt(event.price!.grossWei!))} ${event.price!.asset}`, day]; break;
    case 'LONGEST_HOLD': facts = [metadata.name, `held for ${Math.floor(row.holdSeconds! / 86400)} days before this sale`];
      // This card measures the longest completed hold up to the event, not just its last hold.
      { const closed = parsed.events.filter(item => item.event.tokenId === event.tokenId && (item.event.block < event.block || item.event.block === event.block && item.event.logIndex <= event.logIndex) && item.holdSeconds !== null && item.event.from !== item.event.to).sort((a,b) => b.holdSeconds! - a.holdSeconds!)[0]!;
        facts = [metadata.name, `longest completed hold: ${Math.floor(closed.holdSeconds! / 86400)} days`]; sources = [closed.sources.transfer, ...(closed.sources.arrival ? [closed.sources.arrival] : [])]; }
      break;
    case 'LAST_NIGHT': facts = [metadata.name, `recorded sale on ${day}`]; break;
    case 'ROOMMATES': {
      const held = new Map<number,Classification>(); for (const item of prior) held.set(item.tokenId,item);
      const others = [...held.values()].filter(item => item.to === event.to && item.tokenId !== event.tokenId).sort((a,b) => a.tokenId-b.tokenId);
      if (others.length) { const other = others[0]!; const m = JSON.parse(await readFile(new URL(`data/metadata/${other.tokenId}.json`,root),'utf8')).metadata; facts = [metadata.name, `shares a wallet with ${m.name}`]; sources.push(source(other)); }
      else facts = [metadata.name,'no other Chog in this wallet at arrival'];
      break;
    }
    case 'ARRIVAL': facts = [metadata.name, `arrived on ${day}`]; break;
    case 'GIFT_OR_SALE': facts = [metadata.name,'a sale with verified payment']; break;
    case 'PRICE_TALK': facts = [metadata.name, `${formatEther(BigInt(event.price!.grossWei!))} ${event.price!.asset}`]; break;
    case 'KNOW_WALLET': facts = [metadata.name, `${short(event.from)} held this Chog`]; break;
    case 'OWNER_COUNT': {
      const owners = new Set(tokenMoves.map(item => item.to)); facts = [metadata.name,`${owners.size} recorded owner wallets`]; sources = tokenMoves.map(source); break;
    }
    case 'ODD_MOVES': {
      const recent = tokenMoves.filter(item => times.get(item.block)! >= time - 14*86400); facts = [metadata.name,`${recent.length} transfers in the preceding fourteen days`]; sources = recent.map(source); break;
    }
  }
  const trueFacts = [...facts];
  if (isLie) {
    const last = facts.at(-1)!;
    if (card === 'KNOW_WALLET') facts[facts.length-1] = `${short(event.from)} never held this Chog`;
    else if (card === 'ROOMMATES') {
      const otherId = event.tokenId === 1 ? 2 : 1;
      const other = JSON.parse(await readFile(new URL(`data/metadata/${otherId}.json`,root),'utf8')).metadata;
      facts[facts.length-1] = last.includes('shares a wallet') ? 'no other Chog in this wallet at arrival' : `shares a wallet with ${other.name}`;
    } else if (card === 'PRICE_TALK') facts[facts.length-1] = `${formatEther(BigInt(event.price!.grossWei!) * 112n / 100n)} ${event.price!.asset}`;
    else if (/\d/.test(last)) {
      const date = last.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      facts[facts.length-1] = date ? last.replace(date,new Date(Date.parse(date)+86400000).toISOString().slice(0,10)) : last.replace(/\d+/,value => String(Number(value)+1));
    } else facts[facts.length-1] = card === 'GIFT_OR_SALE' ? 'no recorded payment for this move' : 'a different Chog shares this wallet';
  }
  const input: WitnessInput = { id: `eval-${String(rows.length+1).padStart(3,'0')}`, card, voice, isLie,
    cleanPersona: `${voice} voice; ${(metadata.attributes as {trait_type:string;value:string}[]).map(attribute => `${attribute.trait_type}: ${clean(attribute)}`).join('; ')}`, displayFacts: facts, trueFacts, sources };
  templateLine(input); rows.push(input);
}
const directory = new URL('runs/witness-eval/',root); await mkdir(directory,{recursive:true});
await writeFile(new URL('corpus.json',directory),JSON.stringify({generatedAt:new Date().toISOString(),scope:'Private evaluation only. Planned false testimony never published.',rows},null,2));
await writeFile(new URL('template-preview.json',directory),JSON.stringify(rows.map(row=>({input:row,output:templateLine(row)})),null,2));
console.log(JSON.stringify({rows:rows.length,cards:cards.length,voices:voices.length,true:rows.filter(row=>!row.isLie).length,plannedLies:rows.filter(row=>row.isLie).length,liveModelEvaluation:'NOT_RUN'},null,2));
