import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../../db/pool'
import { env } from '../../config/env'
import { requireAuth, requireRole } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { publicStrictRateLimiter } from '../../middleware/rateLimit'
import { notFound } from '../../utils/errors'
import {
  createIncomingCall,
  answerCall,
  registerEmergencyFromCall,
  endCall,
  handleDriverDtmf,
} from './service'
import { EMERGENCY_TYPES } from '../../types/contract'

export const telephonyRouter = Router()

// Public config endpoint
telephonyRouter.get('/telephony/config', (_req, res) => {
  res.json({
    helplineNumber: env.HELPLINE_DEMO_NUMBER || '1800-000-0000',
    simulated: true,
    notice: '100% simulated telephony layer for academic demo. Never places real emergency calls.',
  })
})

const incomingCallSchema = z.object({
  callerNumber: z.string().min(7, 'Caller phone number is required'),
  callerName: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})

// Public simulated helpline dial endpoint
telephonyRouter.post(
  '/calls/incoming',
  publicStrictRateLimiter,
  validate({ body: incomingCallSchema }),
  async (req, res, next) => {
    try {
      const call = await createIncomingCall(req.body)
      res.status(201).json(call)
    } catch (err) {
      next(err)
    }
  }
)

// Answer incoming call by operator
telephonyRouter.post('/calls/:id/answer', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const updated = await answerCall(req.params.id, req.user!.id)
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

const registerFromCallSchema = z.object({
  type: z.enum(EMERGENCY_TYPES.map((t) => t.id) as any),
  reporterName: z.string().min(2),
  reporterPhone: z.string().min(7),
  description: z.string().max(1000).optional(),
  pickup: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().optional(),
  }),
  severity: z.enum(['critical', 'high', 'medium']).optional(),
})

// Register emergency from call session
telephonyRouter.post(
  '/calls/:id/register-emergency',
  requireAuth,
  requireRole('admin'),
  validate({ body: registerFromCallSchema }),
  async (req, res, next) => {
    try {
      const emgCase = await registerEmergencyFromCall(
        req.params.id,
        req.body,
        { id: req.user!.id, role: 'admin' }
      )
      res.status(201).json(emgCase)
    } catch (err) {
      next(err)
    }
  }
)

// End call session
telephonyRouter.post('/calls/:id/end', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const endReason = req.body?.endReason || 'operator_ended'
    const ended = await endCall(req.params.id, endReason)
    res.json(ended)
  } catch (err) {
    next(err)
  }
})

const dtmfSchema = z.object({
  digit: z.string().min(1).max(2),
})

// Driver IVR DTMF keypad response
telephonyRouter.post(
  '/calls/:id/dtmf',
  requireAuth,
  requireRole('driver', 'admin'),
  validate({ body: dtmfSchema }),
  async (req, res, next) => {
    try {
      const result = await handleDriverDtmf(req.params.id, req.body.digit, req.user!.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

// List calls history
telephonyRouter.get('/calls', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { direction, status, emergencyId } = req.query
    const conditions: string[] = []
    const values: any[] = []

    if (direction) {
      values.push(direction)
      conditions.push(`direction = $${values.length}`)
    }
    if (status) {
      values.push(status)
      conditions.push(`status = $${values.length}`)
    }
    if (emergencyId) {
      values.push(emergencyId)
      conditions.push(`emergency_id = $${values.length}`)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await pool.query(
      `SELECT * FROM call_sessions ${where} ORDER BY started_at DESC LIMIT 100`,
      values
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// Call detail + events log
telephonyRouter.get('/calls/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const sessionRes = await pool.query('SELECT * FROM call_sessions WHERE id = $1', [req.params.id])
    if (sessionRes.rows.length === 0) {
      throw notFound('Call session')
    }

    const eventsRes = await pool.query(
      'SELECT * FROM call_events WHERE call_session_id = $1 ORDER BY at ASC',
      [req.params.id]
    )

    res.json({
      session: sessionRes.rows[0],
      events: eventsRes.rows,
    })
  } catch (err) {
    next(err)
  }
})
