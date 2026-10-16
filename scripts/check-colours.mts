import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { required, type StoredMetadata } from './data-types.mts';

interface ColourEntry { hex: string; source: { tokenId: number; name: string; imageUri: string; metadataUri: string; metadataFetchedAt: string } }
interface ColourConfig { v: number; backgrounds: Record<string, ColourEntry>; tokensWithoutBackground: Record<string, ColourEntry & { reason: string }> }
const colours = JSON.parse(await readFile(new URL('../config/accent-colours.json', import.meta.url), 'utf8')) as ColourConfig;
const usedBackgrounds = new Set<string>();
const withoutBackground: number[] = [];
for (const entry of [...Object.values(colours.backgrounds), ...Object.values(colours.tokensWithoutBackground)]) {
  if (!/^#[0-9A-F]{6}$/.test(entry.hex)) throw new Error('DATA_COLOUR: Invalid colour');
  const stored = JSON.parse(await readFile(new URL(`../data/metadata/${entry.source.tokenId}.json`, import.meta.url), 'utf8')) as StoredMetadata;
  if (stored.uri !== entry.source.metadataUri || stored.metadata.image !== entry.source.imageUri || stored.metadata.name !== entry.source.name || stored.fetchedAt !== entry.source.metadataFetchedAt) throw new Error('DATA_COLOUR: Source does not match stored metadata');
}
for (let tokenId = 1; tokenId <= 1969; tokenId++) {
  const stored = JSON.parse(await readFile(new URL(`../data/metadata/${tokenId}.json`, import.meta.url), 'utf8')) as StoredMetadata;
  const background = stored.metadata.attributes.find(item => item.trait_type === 'Background');
  if (background) {
    usedBackgrounds.add(background.value);
    required(colours.backgrounds[background.value], `DATA_COLOUR: No colour for ${background.value}`);
    if (colours.tokensWithoutBackground[tokenId]) throw new Error(`DATA_COLOUR: Token ${tokenId} has both colour routes`);
  } else {
    required(colours.tokensWithoutBackground[tokenId], `DATA_COLOUR: Explicit colour choice missing for token ${tokenId}`);
    withoutBackground.push(tokenId);
  }
}
if (usedBackgrounds.size !== Object.keys(colours.backgrounds).length || withoutBackground.length !== Object.keys(colours.tokensWithoutBackground).length) throw new Error('DATA_COLOUR: Unused colour mappings');
const result = { checkedAt: new Date().toISOString(), tokensCovered: 1969, backgroundValues: usedBackgrounds.size, tokensWithoutBackground: withoutBackground, pass: true };
const output = new URL('../runs/checks/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('colour-check.json', output), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
