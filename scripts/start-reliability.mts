import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, process.argv[2] ?? `runs/reliability/${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(resolve(directory, '..'), { recursive: true });
await mkdir(directory); // Refuse to overwrite or run a second audit in an existing directory.
const output = openSync(resolve(directory, 'monitor.log'), 'a');
try {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/live-indexer.mts', directory, 'now'], {
    cwd: root, detached: true, stdio: ['ignore', output, output], env: { ...process.env, INDEXER_RUN_SECONDS: '21600' },
  });
  await once(child, 'spawn');
  child.unref();
  const launch = { pid: child.pid, launchedAt: new Date().toISOString(), durationSeconds: 21600, directory,
    note: 'Monitor must remain running for six hours. Check run-summary.json, monitor.log and the final reliability-report.json. Host sleep or shutdown can interrupt the check.' };
  await writeFile(resolve(directory, 'launch.json'), JSON.stringify(launch, null, 2));
  console.log(JSON.stringify(launch, null, 2));
} finally { closeSync(output); }
