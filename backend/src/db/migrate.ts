import fs from 'node:fs'
import path from 'node:path'
import { pool } from './pool'
import { logger } from '../utils/logger'

// backend/migrations/*.sql, applied in filename order, each exactly once.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations')

export async function runMigrations(): Promise<number> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  const done = new Set((await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename))
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  let applied = 0
  for (const file of files) {
    if (done.has(file)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
      await client.query('COMMIT')
      logger.info(`Applied migration ${file}`)
      applied++
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }
  if (applied === 0) logger.info('Database already up to date.')
  return applied
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      logger.error(err.message)
      process.exit(1)
    })
}
