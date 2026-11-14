import fs from 'node:fs'
import path from 'node:path'
import { pool } from './pool'
import { logger } from '../utils/logger'

interface JsonHospital {
  id: string
  name: string
  lat: number
  lng: number
  address?: string
  state?: string
  district?: string
  phone?: string
  specialties?: string
  category?: string
  careType?: string
}

async function importHospitals() {
  const filePath = path.resolve(__dirname, '../../../public/hospital_directory.json')
  if (!fs.existsSync(filePath)) {
    logger.error({ filePath }, 'hospital_directory.json not found.')
    process.exit(1)
  }

  logger.info('Reading public/hospital_directory.json...')
  const raw = fs.readFileSync(filePath, 'utf8')
  const hospitals: JsonHospital[] = JSON.parse(raw)

  logger.info(`Loaded ${hospitals.length} hospital records from directory. Importing...`)

  let imported = 0
  let skipped = 0

  for (const h of hospitals) {
    if (!h.name || typeof h.lat !== 'number' || typeof h.lng !== 'number') {
      skipped++
      continue
    }

    if (isNaN(h.lat) || isNaN(h.lng) || h.lat < -90 || h.lat > 90 || h.lng < -180 || h.lng > 180) {
      skipped++
      continue
    }

    // Never overwrite demo rows
    const existing = await pool.query(
      `SELECT id, is_demo FROM hospitals WHERE name = $1 LIMIT 1`,
      [h.name]
    )

    if (existing.rows.length > 0) {
      skipped++
      continue
    }

    // Parse specialties into array or general
    let specialties: string[] = ['general']
    if (h.specialties && typeof h.specialties === 'string') {
      const parsed = h.specialties
        .split(/[,\n/]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 2)
      if (parsed.length > 0) specialties = parsed
    }

    const fullAddress = [h.address, h.district, h.state].filter(Boolean).join(', ')

    await pool.query(
      `INSERT INTO hospitals (
         name, address, category, lat, lng,
         is_operational, capacity_status, beds, icu_beds,
         specialties, last_updated, is_demo
       )
       VALUES ($1, $2, $3, $4, $5, TRUE, 'unknown', NULL, NULL, $6, now(), FALSE)
       ON CONFLICT DO NOTHING`,
      [h.name, fullAddress || 'Unspecified Address', h.category || h.careType || 'Hospital', h.lat, h.lng, specialties]
    )

    imported++
    if (imported % 500 === 0) {
      logger.info(`Imported ${imported} hospitals...`)
    }
  }

  logger.info(`Hospital import complete. Imported: ${imported}, Skipped/Existing: ${skipped}.`)
}

if (require.main === module) {
  importHospitals()
    .then(() => pool.end())
    .catch((err) => {
      logger.error(err)
      process.exit(1)
    })
}

export { importHospitals }
