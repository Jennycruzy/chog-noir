import { hasErrorCode } from './data-types.mts';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from './env.mts';

await loadEnv();
let token = process.env.VERCEL_TOKEN;
if (!token) {
  const path = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json') : join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json');
  try { token = JSON.parse(await readFile(path, 'utf8')).token; }
  catch (error) { if (!hasErrorCode(error, 'ENOENT')) throw error; }
}
if (!token) throw new Error('HOST_AUTH: Vercel sign-in needed');
const fetchedAt = new Date().toISOString();
const response = await fetch('https://api.vercel.com/v2/user', { headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'ChogNoir/0.1' }, signal: AbortSignal.timeout(15000) });
const body = await response.json();
const result = { fetchedAt, status: response.status, username: body.user?.username || null, error: body.error ? { code: body.error.code, message: typeof body.error.message === 'string' ? body.error.message.replaceAll(token, '[hidden]') : null } : null };
const directory = new URL('../runs/checks/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('hosting-auth.json', directory), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!response.ok) process.exitCode = 1;
