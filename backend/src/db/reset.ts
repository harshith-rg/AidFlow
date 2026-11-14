import { env } from '../config/env'
import { pool } from './pool'
import { runMigrations } from './migrate'
import { seed } from './seed'
import { importHospitals } from './importHospitals'
import { logger } from '../utils/logger'

// Wipes EVERYTHING in the database, rebuilds the schema, and loads demo data.
async function reset() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database.')
  logger.warn('Dropping and recreating the public schema...')
  await pool.query('DROP SCHEMA public CASCADE')
  await pool.query('CREATE SCHEMA public')
  await runMigrations()
  await seed()
  await importHospitals()
  logger.info('Reset complete with demo accounts, 12 simulated ambulances, and supplied real-world hospital directory records.')
}

reset()
  .then(() => pool.end())
  .catch((err) => {
    logger.error(err.message ?? err)
    process.exit(1)
  })
