import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { loadEnv } from './env.mts';

await loadEnv();
const run = promisify(execFile);
const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: new URL('../', import.meta.url) });
const files = [...new Set(stdout.split('\0').filter(Boolean))];
const knownSecrets = ['ETHERSCAN_API_KEY', 'HYPERSYNC_TOKEN', 'OPENSEA_API_KEY', 'ANTHROPIC_API_KEY', 'SERVER_PRIVATE_KEY', 'CASE_VAULT_KEY', 'VERCEL_TOKEN', 'ALERT_TELEGRAM_TOKEN'].map(name => process.env[name]).filter((value): value is string => typeof value === 'string' && value.length >= 12);
const patterns = [
  { name: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic key', expression: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Private key file', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
const findings = [];
for (const file of files) {
  if (/(^|\/)release-archive\.json$/.test(file) || /(^|\/)(?:chognoir-private|SPEC-ITEMS\.md)(?:\/|$)/i.test(file) || /(^|\/)[^/]*SPEC[^/]*\.md$/i.test(file) || /(^|\/)\.env(?:\..+)?$/.test(file) && !file.endsWith('.env.example') || /\.(?:pem|key)$/.test(file)) {
    findings.push({ file, reason: 'Private file is tracked' });
    continue;
  }
  const contents = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  if (knownSecrets.some(secret => contents.includes(secret))) findings.push({ file, reason: 'Configured secret found' });
  for (const pattern of patterns) if (pattern.expression.test(contents)) findings.push({ file, reason: pattern.name });
}
if (findings.length) { console.error(JSON.stringify({ code: 'REPO_PRIVATE_DATA', findings })); process.exitCode = 1; }
else console.log(`PASS: ${files.length} repository files checked for private paths, configured secrets and key patterns.`);
