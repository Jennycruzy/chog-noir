import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT ?? 8311);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('HOST_PORT: Invalid port');
const reportPath = process.env.RELIABILITY_REPORT ?? '/home/ubuntu/chog-noir-monitor/runs/reliability-vps/reliability-report.json';
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  if (request.method !== 'GET' || !['/health', '/api/health'].includes(request.url ?? '')) {
    response.writeHead(404); response.end(JSON.stringify({ error: 'NOT_FOUND' })); return;
  }
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (report.status !== 'PASS' || !report.fullWindow || !Number.isSafeInteger(report.toBlockExclusive)) throw new Error('Invalid saved reliability report');
    response.end(JSON.stringify({ service: 'chog-noir', stage: 'M0', gameAvailable: false,
      indexer: { state: 'stopped_after_reliability_check', reliability: report.status, completedAt: report.finishedAt,
        toBlockExclusive: report.toBlockExclusive, transfers: report.stored },
      note: 'Hosting readiness check. No live case has been published.' }));
  } catch {
    response.writeHead(503); response.end(JSON.stringify({ service: 'chog-noir', stage: 'M0', error: 'RELIABILITY_EVIDENCE_UNAVAILABLE' }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Chog Noir readiness API listening on 127.0.0.1:${port}`));
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
