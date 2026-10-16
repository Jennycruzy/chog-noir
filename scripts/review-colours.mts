import { readFile, mkdir, writeFile } from 'node:fs/promises';
import sharp, { type OverlayOptions } from 'sharp';
import { required, type StoredMetadata } from './data-types.mts';

interface ColourSample { tokenId: number; flatCorners: boolean; corners: number[][] }
interface ArtAudit { imagesChecked: number; allImagesPresent: boolean; backgrounds: Record<string, ColourSample[]>; traitExceptions: Array<{ tokenId: number; missingBackground: boolean }> }
const audit = JSON.parse(await readFile(new URL('../runs/checks/art-check.json', import.meta.url), 'utf8')) as ArtAudit;
if (!audit.allImagesPresent || audit.imagesChecked !== 1969) throw new Error('DATA_ART_CHECK: Complete the artwork check before colour review');
const output = new URL('../runs/colour-review/', import.meta.url);
await mkdir(output, { recursive: true });
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const spread = (sample: ColourSample) => [0, 1, 2].reduce((total, channel) => total + Math.max(...sample.corners.map(pixel => required(pixel[channel], 'DATA_IMAGE: Missing channel'))) - Math.min(...sample.corners.map(pixel => required(pixel[channel], 'DATA_IMAGE: Missing channel'))), 0);
const backgrounds = Object.entries(audit.backgrounds).sort(([left], [right]) => left.localeCompare(right)).map(([label, samples]) => ({ label, tokenId: required([...samples].sort((left, right) => spread(left) - spread(right) || left.tokenId - right.tokenId)[0], 'DATA_ART_CHECK: Empty background group').tokenId }));
const specials = audit.traitExceptions.filter(record => record.missingBackground).map(record => ({ label: 'No Background trait', tokenId: record.tokenId }));
async function sheet(records: Array<{ label: string; tokenId: number }>, name: string) {
  const width = 240;
  const height = 292;
  const columns = 4;
  const tiles: OverlayOptions[] = [];
  const sources = [];
  for (let index = 0; index < records.length; index++) {
    const record = required(records[index], 'DATA_ART_CHECK: Missing review record');
    const metadata = JSON.parse(await readFile(new URL(`../data/metadata/${record.tokenId}.json`, import.meta.url), 'utf8')) as StoredMetadata;
    const thumbnail = await sharp(new URL(`../data/images/${record.tokenId}.webp`, import.meta.url).pathname).resize(width, width).png().toBuffer();
    const caption = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="52"><rect width="100%" height="100%" fill="#17171c"/><text x="12" y="20" fill="#f2ede4" font-family="sans-serif" font-size="14">${xml(record.label)}</text><text x="12" y="41" fill="#b8b8c2" font-family="sans-serif" font-size="12">${xml(metadata.metadata.name)}</text></svg>`);
    const left = index % columns * width;
    const top = Math.floor(index / columns) * height;
    tiles.push({ input: thumbnail, left, top }, { input: caption, left, top: top + width });
    sources.push({ ...record, name: metadata.metadata.name, imageUri: metadata.metadata.image, metadataUri: metadata.uri, metadataFetchedAt: metadata.fetchedAt });
  }
  await sharp({ create: { width: columns * width, height: Math.ceil(records.length / columns) * height, channels: 3, background: '#17171c' } }).composite(tiles).png().toFile(new URL(`${name}.png`, output).pathname);
  await writeFile(new URL(`${name}.json`, output), JSON.stringify({ credit: 'Chog Genesis by CHOGLABS.', sources }, null, 2));
}
await sheet(backgrounds, 'backgrounds');
if (specials.length) await sheet(specials, 'specials');
console.log(`Colour review prepared: ${backgrounds.length} backgrounds and ${specials.length} Chogs without a Background trait.`);
