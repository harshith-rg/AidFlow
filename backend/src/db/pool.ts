import { Pool, type PoolClient } from 'pg'
import { env } from '../config/env'
import { logger } from '../utils/logger'

const connectionString =
  process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test'
    ? env.DATABASE_URL_TEST
    : env.DATABASE_URL

export const pool = new Pool({ connectionString, max: 25 })

pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'))

/** Run several queries as ONE atomic transaction (used for accept/reject/assign). */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
