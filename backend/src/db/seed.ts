import bcrypt from 'bcryptjs'
import { env } from '../config/env'
import { pool } from './pool'
import { logger } from '../utils/logger'

// DEMO DATA ONLY. Hospital names are fictional and bed numbers are made up so nobody mistakes them for real facilities.
const DEMO_HOSPITALS = [
  { name: 'Demo General Hospital (Central)', lat: 12.9716, lng: 77.5946, cap: 'available', beds: 40, icu: 6, spec: ['trauma', 'cardiology', 'general'] },
  { name: 'Demo Heart & Stroke Centre', lat: 12.9352, lng: 77.6245, cap: 'limited', beds: 12, icu: 2, spec: ['cardiology', 'neurology'] },
  { name: 'Demo Trauma & Burns Institute', lat: 13.0358, lng: 77.597, cap: 'available', beds: 25, icu: 4, spec: ['trauma', 'burns', 'orthopaedics'] },
  { name: 'Demo Community Hospital (East)', lat: 12.9784, lng: 77.6408, cap: 'full', beds: 0, icu: 0, spec: ['general'] },
  { name: 'Demo Multi-speciality Hospital (South)', lat: 12.9081, lng: 77.5857, cap: 'available', beds: 60, icu: 10, spec: ['general', 'cardiology', 'pulmonology'] },
] as const

const DEMO_AMBULANCES = [
  { label: 'AMB-01', plate: 'DEMO-0001', lat: 12.9725, lng: 77.6, status: 'available' },
  { label: 'AMB-02', plate: 'DEMO-0002', lat: 12.945, lng: 77.62, status: 'available' },
  { label: 'AMB-03', plate: 'DEMO-0003', lat: 13.02, lng: 77.59, status: 'available' },
  { label: 'AMB-04', plate: 'DEMO-0004', lat: 12.92, lng: 77.58, status: 'offline' },
  { label: 'AMB-05', plate: 'DEMO-0005', lat: 12.955, lng: 77.65, status: 'available' },
  { label: 'AMB-06', plate: 'DEMO-0006', lat: 12.995, lng: 77.56, status: 'available' },
  { label: 'AMB-07', plate: 'DEMO-0007', lat: 12.987, lng: 77.57, status: 'available' },
  { label: 'AMB-08', plate: 'DEMO-0008', lat: 12.905, lng: 77.585, status: 'available' },
  { label: 'AMB-09', plate: 'DEMO-0009', lat: 13.035, lng: 77.597, status: 'available' },
  { label: 'AMB-10', plate: 'DEMO-0010', lat: 12.948, lng: 77.55, status: 'available' },
  { label: 'AMB-11', plate: 'DEMO-0011', lat: 12.92, lng: 77.61, status: 'available' },
  { label: 'AMB-12', plate: 'DEMO-0012', lat: 13.01, lng: 77.65, status: 'available' },
] as const

async function seed() {
  const existing = await pool.query('SELECT count(*)::int AS n FROM users')
  if (existing.rows[0].n > 0) {
    logger.warn('Database already has users, skipping seed. Run "npm run db:reset" for a clean demo database.')
    return
  }
  const hash = bcrypt.hashSync(env.SEED_DEMO_PASSWORD, 10)

  const hospitalIds: string[] = []
  for (const h of DEMO_HOSPITALS) {
    const r = await pool.query(
      `INSERT INTO hospitals (name, address, category, lat, lng, capacity_status, beds, icu_beds, specialties, last_updated, is_demo)
       VALUES ($1, 'Demo address', 'Demo hospital', $2, $3, $4, $5, $6, $7, now(), TRUE) RETURNING id`,
      [h.name, h.lat, h.lng, h.cap, h.beds, h.icu, h.spec],
    )
    hospitalIds.push(r.rows[0].id)
  }

  const addUser = async (email: string, role: string, name: string, hospitalId: string | null = null) =>
    (
      await pool.query(
        `INSERT INTO users (email, password_hash, role, name, hospital_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [email, hash, role, name, hospitalId],
      )
    ).rows[0].id as string

  await addUser('admin@aidflow.demo', 'admin', 'Demo Control Room')
  await addUser('patient@aidflow.demo', 'patient', 'Demo Patient')
  await addUser('hospital@aidflow.demo', 'hospital', 'Demo Hospital Desk', hospitalIds[0])

  for (let i = 0; i < DEMO_AMBULANCES.length; i++) {
    const a = DEMO_AMBULANCES[i]
    const driverId = await addUser(`driver${i + 1}@aidflow.demo`, 'driver', `Demo Driver ${i + 1}`)
    await pool.query(
      `INSERT INTO ambulances (label, vehicle_number, driver_id, status, lat, lng, last_location_at, is_test)
       VALUES ($1,$2,$3,$4,$5,$6,now(),TRUE)`,
      [a.label, a.plate, driverId, a.status, a.lat, a.lng],
    )
  }
  logger.info(
    `Seeded ${DEMO_HOSPITALS.length} hospitals, ${DEMO_AMBULANCES.length} ambulances and ${3 + DEMO_AMBULANCES.length} users (demo password from SEED_DEMO_PASSWORD).`,
  )
}

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      logger.error(err)
      process.exit(1)
    })
}

export { seed }
