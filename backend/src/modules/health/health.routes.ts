import { Router } from 'express'
import { pool } from '../../db/pool'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  const base = { service: 'aidflow-backend', time: new Date().toISOString() }
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'up', ...base })
  } catch {
    res.status(503).json({ status: 'degraded', database: 'down', ...base })
  }
})
