import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import { Pool } from 'pg'
import { env } from '../src/config/env'
import type { Role } from '../src/types/contract'

export const testPool = new Pool({ connectionString: env.DATABASE_URL_TEST, max: 25 })

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations')

/**
 * Completely wipes the test database public schema, re-applies all migrations in order.
 */
export async function resetTestDb(): Promise<void> {
  const client = await testPool.connect()
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE')
    await client.query('CREATE SCHEMA public')
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
      await client.query('COMMIT')
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Creates a signed JWT token for a given user payload.
 */
export function createUserToken(payload: {
  id: string
  email: string
  role: Role
  hospitalId?: string | null
}): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '12h' })
}

/**
 * Inserts a user into the test database and returns their id and token.
 */
export async function seedUser(data: {
  id?: string
  email: string
  role: Role
  name?: string
  password?: string
  hospitalId?: string | null
}): Promise<{ id: string; token: string }> {
  const id = data.id || '00000000-0000-0000-0000-' + Math.floor(Math.random() * 899999999999 + 100000000000)
  const name = data.name || 'Test User'
  const passwordHash = '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEF' // dummy bcrypt hash

  await testPool.query(
    `INSERT INTO users (id, email, password_hash, role, name, hospital_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (lower(email)) DO UPDATE
       SET id = EXCLUDED.id, role = EXCLUDED.role, hospital_id = EXCLUDED.hospital_id`,
    [id, data.email.toLowerCase(), passwordHash, data.role, name, data.hospitalId || null]
  )

  const token = createUserToken({ id, email: data.email, role: data.role, hospitalId: data.hospitalId })
  return { id, token }
}

/**
 * Helper to seed an ambulance at given coordinates for spatial & dispatch testing.
 */
export async function seedAmbulance(data: {
  label?: string
  vehicleNumber?: string
  lat: number
  lng: number
  status?: 'available' | 'busy' | 'offline'
  driverId?: string | null
}): Promise<string> {
  const label = data.label || `TEST-AMB-${Math.floor(Math.random() * 9000 + 1000)}`
  const vehicleNumber = data.vehicleNumber || `KA-00-T-${Math.floor(Math.random() * 9000 + 1000)}`
  const status = data.status || 'available'

  const res = await testPool.query(
    `INSERT INTO ambulances (label, vehicle_number, driver_id, status, lat, lng, last_location_at, is_test)
     VALUES ($1, $2, $3, $4, $5, $6, now() - INTERVAL '5 seconds', TRUE) RETURNING id`,
    [label, vehicleNumber, data.driverId || null, status, data.lat, data.lng]
  )
  return res.rows[0].id
}

export async function closeTestPool(): Promise<void> {
  await testPool.end()
}
