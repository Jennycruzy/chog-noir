import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export interface DatabaseConnection {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
  exec(sql: string): Promise<unknown>;
}
export async function migrate(database: DatabaseConnection, directory = new URL('../../apps/api/migrations/', import.meta.url)): Promise<string[]> {
  const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z_]+\.sql$/.test(name)).sort();
  await database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await database.exec('BEGIN');
  try {
    await database.exec('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
    const applied: string[] = [];
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const result = await database.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]) as { rows: { checksum: string }[] };
      if (result.rows.length) {
        if (result.rows[0]?.checksum !== checksum) throw new Error(`DB_MIGRATION_CHANGED: ${name}`);
        continue;
      }
      await database.exec(sql);
      await database.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
      applied.push(name);
    }
    await database.exec('COMMIT');
    return applied;
  } catch (error) {
    await database.exec('ROLLBACK');
    throw error;
  }
}
