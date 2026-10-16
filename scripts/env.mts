import { hasErrorCode } from './data-types.mts';
import { readFile } from 'node:fs/promises';

export async function loadEnv() {
  let text;
  try { text = await readFile(new URL('../.env', import.meta.url), 'utf8'); }
  catch (error) { if (hasErrorCode(error, 'ENOENT')) return; throw error; }
  for (const row of text.split(/\r?\n/)) {
    const match = row.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const name = match[1];
    let value = match[2];
    if (!name || value === undefined || process.env[name]) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[name] = value;
  }
}
