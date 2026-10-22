import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat } from 'node:fs/promises';
import { loadEnv } from './env.mts';

await loadEnv();
const run = promisify(execFile);
const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: new URL('../', import.meta.url) });
const files = [...new Set(stdout.split('\0').filter(Boolean))];
const privatePaths = /(?:^|\/)(?:(?:docs\/)?(?:audit|evals|reviews)(?:\/|$)|(?:decisions|implementation-status|status|playtests|game-preview|archive-review|judge-run)(?:[-.][^/]*)?\.md$)/i;
const internalLabels = /\b(?:audit|milestone|spec|pending human review|user task|A-item|[MN][0-9]+[a-z]?)\b/i;

const knownSecrets = ['ETHERSCAN_API_KEY', 'HYPERSYNC_TOKEN', 'OPENSEA_API_KEY', 'ANTHROPIC_API_KEY', 'SERVER_PRIVATE_KEY', 'CASE_VAULT_KEY', 'VERCEL_TOKEN', 'ALERT_TELEGRAM_TOKEN'].map(name => process.env[name]).filter((value): value is string => typeof value === 'string' && value.length >= 12);
const patterns = [
  { name: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic key', expression: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Private key file', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
const findings = [];
for (const file of files) {
  if (privatePaths.test(file) || /(^|\/)release-archive\.json$/.test(file) || /(^|\/)(?:chognoir-private|SPEC-ITEMS\.md)(?:\/|$)/i.test(file) || /(^|\/)[^/]*SPEC[^/]*\.md$/i.test(file) || /(^|\/)\.env(?:\..+)?$/.test(file) && !file.endsWith('.env.example') || /\.(?:pem|key)$/.test(file)) {
    findings.push({ file, reason: 'Private file is tracked' });
    continue;
  }
  const location = new URL(`../${file}`, import.meta.url);
  let metadata;
  try { metadata = await lstat(location); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
  if (!metadata.isFile()) { findings.push({ file, reason: 'Non-file repository entry' }); continue; }
  const bytes = await readFile(location);
  // Binary files (fonts, images) hold no prose or secrets in text form; scanning their bytes only finds noise.
  if (bytes.includes(0)) continue;
  const contents = bytes.toString('utf8');
  // Dependency security commands and guard declarations are technical controls.
  const scannedContents = file === '.github/workflows/check.yml' ? contents.replace(/pnpm audit --audit-level high/g, '') : contents;
  if (!['scripts/check-private.mts','.gitignore'].includes(file) && (internalLabels.test(scannedContents) || internalLabels.test(file))) findings.push({file, reason:'Internal progress label found'});
  if (file.endsWith('.md') && /\b(?:audit|spec)\b/i.test(contents)) findings.push({file, reason:'Internal document wording found'});

  if (knownSecrets.some(secret => contents.includes(secret))) findings.push({ file, reason: 'Configured secret found' });
  for (const pattern of patterns) if (pattern.expression.test(contents)) findings.push({ file, reason: pattern.name });
}
if (findings.length) { console.error(JSON.stringify({ code: 'REPO_PRIVATE_DATA', findings })); process.exitCode = 1; }
else console.log(`PASS: ${files.length} repository files checked for private paths, configured secrets and key patterns.`);
