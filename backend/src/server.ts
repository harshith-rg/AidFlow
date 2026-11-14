import http from 'node:http'
import { app } from './app'
import { env } from './config/env'
import { pool } from './db/pool'
import { logger } from './utils/logger'
import { setupSocketIO } from './realtime/socket'
import { startScheduler, stopScheduler } from './modules/dispatch/scheduler'

const server = http.createServer(app)
setupSocketIO(server)

server.listen(env.PORT, async () => {
  logger.info(`AidFlow backend listening on http://localhost:${env.PORT}`)
  try {
    await pool.query('SELECT 1')
    logger.info('PostgreSQL connection OK')
    startScheduler(2000)
  } catch (err) {
    logger.error({ err }, 'Cannot reach PostgreSQL. Check DATABASE_URL, then run "npm run db:reset".')
  }
})

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`)
  stopScheduler()
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
