import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole, optionalAuth } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import {
  createEmergencyCase,
  getEmergencyCase,
  listEmergencyCases,
  cancelEmergencyCase,
  completeEmergencyCase,
  assignEmergencyCase,
  type ActorInfo,
} from './emergencies.service'
import { EMERGENCY_TYPES, type CaseStatus, type EmergencyTypeId, type Severity } from '../../types/contract'
import { forbidden } from '../../utils/errors'
import { emitToRoom } from '../../realtime/events'
import { pool } from '../../db/pool'

export const emergenciesRouter = Router()

const emergencyTypeIds = EMERGENCY_TYPES.map((t) => t.id) as [string, ...string[]]

const createSchema = z.object({
  type: z.enum(emergencyTypeIds as any),
  reporterName: z.string().min(2, 'Reporter name must be at least 2 characters'),
  reporterPhone: z.string().min(7, 'Phone number must be at least 7 digits'),
  description: z.string().max(1000).optional(),
  pickup: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().optional(),
  }),
  source: z.enum(['web', 'call', 'manual']).optional(),
  severity: z.enum(['critical', 'high', 'medium']).optional(),
  callSessionId: z.string().uuid().optional(),
})

const cancelSchema = z.object({
  reason: z.string().min(1, 'Reason for cancellation is required'),
})

const assignSchema = z.object({
  ambulanceId: z.string().uuid('Valid ambulance ID is required'),
})

emergenciesRouter.post(
  '/emergencies',
  optionalAuth,
  validate({ body: createSchema }),
  async (req, res, next) => {
    try {
      const actor: ActorInfo = req.user
        ? { id: req.user.id, role: req.user.role, hospitalId: req.user.hospitalId }
        : { id: null, role: 'patient' }

      // Non-admins cannot submit source 'call' or 'manual'
      if ((req.body.source === 'call' || req.body.source === 'manual') && actor.role !== 'admin') {
        throw forbidden("Only administrators can report emergencies with source 'call' or 'manual'.")
      }

      const result = await createEmergencyCase(req.body, actor)
      const alertMessage = `NEW EMERGENCY: ${result.type} reported by ${result.reporterName} at ${result.pickup.address || `${result.pickup.lat.toFixed(5)}, ${result.pickup.lng.toFixed(5)}`}`
      const alert = await pool.query(
        `INSERT INTO alerts (type, message, emergency_id, target_role) VALUES ('emergency_reported', $1, (SELECT id FROM emergencies WHERE case_code=$2), 'admin') RETURNING id, created_at`,
        [alertMessage, result.id]
      )
      emitToRoom('role:admin', 'case:created', { caseId: result.id, emergency: result })
      emitToRoom('role:admin', 'alert:new', { id: alert.rows[0].id, type: 'emergency_reported', message: alertMessage, emergencyId: result.id, targetRole: 'admin', createdAt: alert.rows[0].created_at })
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  }
)

emergenciesRouter.get('/emergencies', requireAuth, requireRole('admin', 'hospital'), async (req, res, next) => {
  try {
    const actor: ActorInfo = {
      id: req.user!.id,
      role: req.user!.role,
      hospitalId: req.user!.hospitalId,
    }

    const filters = {
      status: req.query.status as CaseStatus | undefined,
      type: req.query.type as EmergencyTypeId | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      cursor: req.query.cursor as string | undefined,
    }

    const cases = await listEmergencyCases(filters, actor)
    res.status(200).json(cases)
  } catch (err) {
    next(err)
  }
})

// Public read-only feed for the classroom/demo Control Room. Do not expose this mode on a production deployment.
emergenciesRouter.get('/control-room/cases', async (_req, res, next) => {
  try {
    const cases = await listEmergencyCases({ limit: 1000 }, { id: null, role: 'admin' })
    res.status(200).json(cases)
  } catch (err) { next(err) }
})

emergenciesRouter.get('/control-room/cases/:id', async (req, res, next) => {
  try {
    const result = await getEmergencyCase(req.params.id, { id: null, role: 'admin' })
    res.status(200).json(result)
  } catch (err) { next(err) }
})

emergenciesRouter.get('/emergencies/:id', optionalAuth, async (req, res, next) => {
  try {
    const actor: ActorInfo | undefined = req.user
      ? { id: req.user.id, role: req.user.role, hospitalId: req.user.hospitalId }
      : undefined

    const result = await getEmergencyCase(req.params.id, actor)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})

emergenciesRouter.post(
  '/emergencies/:id/cancel',
  requireAuth,
  validate({ body: cancelSchema }),
  async (req, res, next) => {
    try {
      const actor: ActorInfo = {
        id: req.user!.id,
        role: req.user!.role,
        hospitalId: req.user!.hospitalId,
      }
      const result = await cancelEmergencyCase(req.params.id, req.body.reason, actor)
      res.status(200).json(result)
    } catch (err) {
      next(err)
    }
  }
)

emergenciesRouter.post('/emergencies/:id/complete', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const actor: ActorInfo = {
      id: req.user!.id,
      role: req.user!.role,
      hospitalId: req.user!.hospitalId,
    }
    const result = await completeEmergencyCase(req.params.id, actor)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})

emergenciesRouter.post(
  '/emergencies/:id/assign',
  requireAuth,
  requireRole('admin'),
  validate({ body: assignSchema }),
  async (req, res, next) => {
    try {
      const actor: ActorInfo = {
        id: req.user!.id,
        role: req.user!.role,
        hospitalId: req.user!.hospitalId,
      }
      const result = await assignEmergencyCase(req.params.id, req.body.ambulanceId, actor)
      res.status(200).json(result)
    } catch (err) {
      next(err)
    }
  }
)
