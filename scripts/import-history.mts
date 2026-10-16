import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from '../packages/database/migrate.mts';
import { importHistory, type HistoryInput } from '../packages/database/import-history.mts';
import { loadEnv } from './env.mts';
import { type StoredMetadata, type StoredHistory } from './data-types.mts';
import { historySources } from './history-sources.mts';
await loadEnv();
const localCheck=process.argv.includes('--local-check');
const history=JSON.parse(await readFile(new URL('../data/related/history.json',import.meta.url),'utf8')) as StoredHistory;
const metadata:HistoryInput['metadata']=[];
for(let tokenId=1;tokenId<=1969;tokenId++) {
  const stored=JSON.parse(await readFile(new URL(`../data/metadata/${tokenId}.json`,import.meta.url),'utf8')) as StoredMetadata;
  metadata.push({tokenId,...stored});
}
// HyperSync's selected transaction status is checked before any records are written.
const transactions=history.data.transactions as HistoryInput['transactions'];
const sources=await historySources(new URL('../data/related/',import.meta.url));
const input:HistoryInput={sources,fetchedAt:history.finishedAt,toBlockExclusive:history.toBlockExclusive,blocks:history.data.blocks,transactions,logs:history.data.logs,metadata};
if(localCheck) {
  const {PGlite}=await import('@electric-sql/pglite');
  const database=new PGlite();
  try {
    await migrate(database);
    const result=await importHistory(database,input);
    const counts=await database.query<{classification:string;count:string}>('SELECT classification,count(*)::text AS count FROM events_classified GROUP BY classification ORDER BY classification');
    const first=await database.query<{token_id:number;metadata_name:string}>('SELECT token_id,metadata_name FROM chogs WHERE token_id IN (1,1021,1864) ORDER BY token_id');
    const report={checkedAt:new Date().toISOString(),mode:'offline-check',...result,counts:counts.rows,names:first.rows};
    await mkdir(new URL('../runs/checks/',import.meta.url),{recursive:true});
    await writeFile(new URL('../runs/checks/database-import.json',import.meta.url),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally {await database.close();}
} else {
  if(!process.env.DATABASE_URL) throw new Error('DB_CONFIGURATION: Set DATABASE_URL in the local .env file, or use --local-check');
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});
  try {
    await client.connect();
    const database={query:(sql:string,values?:unknown[])=>client.query(sql,values),exec:(sql:string)=>client.query(sql)};
    await migrate(database);
    console.log(JSON.stringify(await importHistory(database,input)));
  } catch {
    console.error(JSON.stringify({code:'DB_IMPORT_FAILED',message:'History import failed; no partial import was saved. Check database access and stored source records.'}));process.exitCode=1;
  } finally {await client.end();}
}
