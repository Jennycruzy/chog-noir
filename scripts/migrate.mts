import pg from 'pg';
import { loadEnv } from './env.mts';
import { migrate } from '../packages/database/migrate.mts';
await loadEnv();
if (!process.env.DATABASE_URL) {
  console.error(JSON.stringify({ code: 'DB_CONFIGURATION', message: 'Set DATABASE_URL in the local .env file.' }));
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const applied = await migrate({ query: (sql, parameters) => client.query(sql, parameters), exec: sql => client.query(sql) });
  console.log(JSON.stringify({ applied, count: applied.length }));
} catch (error) {
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'DB_MIGRATION_FAILED';
  console.error(JSON.stringify({ code, message: 'Database migration failed. Check database access and migration files.' }));
  process.exitCode = 1;
} finally { await client.end(); }
