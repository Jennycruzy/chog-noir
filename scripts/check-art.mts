import { required, hasErrorCode, type TokenMapping, type StoredMetadata } from './data-types.mts';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = new URL('../data/', import.meta.url);
const map = JSON.parse(await readFile(new URL('token_to_file.json', root), 'utf8')) as Record<string, TokenMapping>;
if (Object.keys(map).length !== 1969 || new Set(Object.values(map).map(item => item.file)).size !== 1969) throw new Error('DATA_METADATA: Incomplete or duplicate token mapping');
const records: Array<{ tokenId: number; name: string; metadataUri: string; metadataFetchedAt: string; imageUri: string; sha256: string; bytes: number; width: number; height: number; flatCorners: boolean }> = [];
const missing = [];
const backgrounds = new Map<string, Array<{ tokenId: number; flatCorners: boolean; corners: number[][] }>>();
const traitExceptions = [];
const expectedNames = new Map([[1, 'CHOG #1462'], [1021, 'CHOG #513'], [1864, 'CHOG #1356']]);
const positions: Array<[number, number]> = [[5, 5], [994, 5], [5, 994], [994, 994], [10, 10]];
for (let tokenId = 1; tokenId <= 1969; tokenId++) {
  let stored: StoredMetadata;
  let image;
  try {
    stored = JSON.parse(await readFile(new URL(`metadata/${tokenId}.json`, root), 'utf8'));
    image = await readFile(new URL(`images/${tokenId}.webp`, root));
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    missing.push(tokenId);
    continue;
  }
  const metadata = stored.metadata;
  if (!metadata || stored.uri !== required(map[tokenId], 'DATA_METADATA: Token mapping missing').uri || !Number.isFinite(Date.parse(stored.fetchedAt))) throw new Error(`DATA_METADATA: Missing source for ${tokenId}`);
  if (typeof metadata.name !== 'string' || !metadata.name.trim()) throw new Error(`DATA_NAME: Missing metadata name for ${tokenId}`);
  if (expectedNames.has(tokenId) && expectedNames.get(tokenId) !== metadata.name) throw new Error(`DATA_NAME: Spot check failed for ${tokenId}`);
  const background = metadata.attributes.find(item => item.trait_type === 'Background');
  const traitNames = new Set(metadata.attributes.map(item => item.trait_type));
  const missingPowerTraits = ['Eyes', 'Mouth', 'Side', 'Tier', 'Form'].filter(trait => !traitNames.has(trait));
  if (typeof background?.value !== 'string' || missingPowerTraits.length) traitExceptions.push({ tokenId, name: metadata.name, metadataUri: stored.uri, missingBackground: typeof background?.value !== 'string', missingPowerTraits, base: metadata.attributes.find(item => item.trait_type === 'Base')?.value || null });
  const { data: pixels, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 1000 || info.height !== 1000) throw new Error(`DATA_IMAGE: Wrong dimensions for ${tokenId}`);
  const corners = positions.map(([x, y]) => [...pixels.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]);
  const spread = Math.max(...[0, 1, 2].map(channel => Math.max(...corners.map(pixel => required(pixel[channel], 'DATA_IMAGE: Colour channel missing'))) - Math.min(...corners.map(pixel => required(pixel[channel], 'DATA_IMAGE: Colour channel missing')))));
  const flatCorners = spread <= 12;
  if (typeof background?.value === 'string') {
    const entries = backgrounds.get(background.value) || [];
    entries.push({ tokenId, flatCorners, corners });
    backgrounds.set(background.value, entries);
  }
  records.push({ tokenId, name: metadata.name, metadataUri: stored.uri, metadataFetchedAt: stored.fetchedAt, imageUri: metadata.image, sha256: createHash('sha256').update(image).digest('hex'), bytes: image.length, width: info.width, height: info.height, flatCorners });
  if (records.length % 200 === 0) console.log(`Artwork checked: ${records.length}`);
}
const summary = { checkedAt: new Date().toISOString(), imagesChecked: records.length, missingCount: missing.length, allImagesPresent: missing.length === 0, backgroundsFound: backgrounds.size, traitExceptionCount: traitExceptions.length, flatCornerImages: records.filter(record => record.flatCorners).length, nonFlatCornerImages: records.filter(record => !record.flatCorners).length, samplingTolerancePerChannel: 12, nameSpotChecks: [...expectedNames].map(([tokenId, expected]) => ({ tokenId, expected, actual: records.find(record => record.tokenId === tokenId)?.name || null })), cornerSamplingWorksForEveryImage: records.length === 1969 && records.every(record => record.flatCorners) };
const output = new URL('../runs/checks/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('art-check.json', output), JSON.stringify({ ...summary, missing, traitExceptions, backgrounds: Object.fromEntries(backgrounds), records }, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (missing.length) process.exitCode = 1;
if (traitExceptions.length) console.error(`DATA_TRAIT: ${traitExceptions.length} tokens lack Background or power traits; review required.`);
