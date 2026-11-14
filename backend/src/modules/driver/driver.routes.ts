import { Router } from 'express'
import { z } from 'zod'
import { pool, withTransaction } from '../../db/pool'
import { requireAuth, requireRole } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { forbidden, notFound, badRequest } from '../../utils/errors'
import { changeStatus } from '../emergencies/stateMachine'
import { getEmergencyCase } from '../emergencies/emergencies.service'
import { toEmergencyCase } from '../emergencies/emergencies.mapper'
import { emitToRoom, emitToAll } from '../../realtime/events'
import type { CaseStatus } from '../../types/contract'

export const driverRouter = Router()

// GET /driver/requests: pending dispatch offers and active case
driverRouter.get('/driver/requests', requireAuth, requireRole('driver', 'admin'), async (req, res, next) => {
  try {
    const driverId = req.user!.id

    // Find driver's ambulance
    const ambRes = await pool.query('SELECT * FROM ambulances WHERE driver_id = $1', [driverId])
    if (ambRes.rows.length === 0) {
      return res.json({
        ambulance: null,
        pendingOffer: null,
        activeCase: null,
      })
    }

    const amb = ambRes.rows[0]

    // Find open pending offer
    const offerRes = await pool.query(
      `SELECT da.id as attempt_id, da.attempt_no, da.offered_at, da.expires_at, da.via,
              e.*
       FROM dispatch_attempts da
       JOIN emergencies e ON da.emergency_id = e.id
       WHERE da.ambulance_id = $1 AND da.outcome = 'pending' AND da.expires_at > now()
       ORDER BY da.offered_at DESC
       LIMIT 1`,
      [amb.id]
    )

    let pendingOffer = null
    if (offerRes.rows.length > 0) {
      const o = offerRes.rows[0]
      pendingOffer = {
        attemptId: o.attempt_id,
        attemptNo: o.attempt_no,
        expiresAt: new Date(o.expires_at).toISOString(),
        via: o.via,
        case: toEmergencyCase(o),
      }
    }

    // Find active case
    const activeRes = await pool.query(
      `SELECT e.*,
              h.name as hosp_name, h.lat as hosp_lat, h.lng as hosp_lng, h.address as hosp_address,
              h.phone as hosp_phone, h.category as hosp_category, h.capacity_status as hosp_capacity_status,
              h.beds as hosp_beds, h.icu_beds as hosp_icu_beds, h.last_updated as hosp_last_updated
       FROM emergencies e
       LEFT JOIN hospitals h ON e.hospital_id = h.id
       WHERE e.assigned_ambulance_id = $1
         AND e.status IN ('assigned', 'en_route', 'reached_patient', 'heading_to_hospital', 'handed_over')
       LIMIT 1`,
      [amb.id]
    )

    let activeCase = null
    if (activeRes.rows.length > 0) {
      activeCase = toEmergencyCase(activeRes.rows[0])
    }

    res.json({
      ambulance: {
        id: amb.id,
        label: amb.label,
        vehicleNumber: amb.vehicle_number,
        status: amb.status,
        lat: amb.lat,
        lng: amb.lng,
      },
      pendingOffer,
      activeCase,
    })
  } catch (err) {
    next(err)
  }
})

const journeyStatusSchema = z.object({
  status: z.enum(['en_route', 'reached_patient', 'heading_to_hospital', 'handed_over']),
  note: z.string().optional(),
})

// PATCH /driver/cases/:id/status: progression through en_route -> reached_patient -> heading_to_hospital -> handed_over
driverRouter.patch(
  '/driver/cases/:id/status',
  requireAuth,
  requireRole('driver', 'admin'),
  validate({ body: journeyStatusSchema }),
  async (req, res, next) => {
    try {
      const caseCodeOrId = req.params.id
      const targetStatus = req.body.status as CaseStatus
      const note = req.body.note || `Driver updated status to ${targetStatus}`

      const updatedCase = await withTransaction(async (client) => {
        // Lock case
        const caseRes = await client.query(
          `SELECT e.id, e.case_code, e.assigned_ambulance_id, e.status, a.driver_id, a.label
           FROM emergencies e
           LEFT JOIN ambulances a ON e.assigned_ambulance_id = a.id
           WHERE e.case_code = $1 OR e.id::text = $1
           FOR UPDATE`,
          [caseCodeOrId]
        )

        if (caseRes.rows.length === 0) {
          throw notFound('Emergency case')
        }

        const emg = caseRes.rows[0]

        // Verify driver owns assigned ambulance
        if (req.user!.role !== 'admin' && emg.driver_id !== req.user!.id) {
          throw forbidden('You are not the driver assigned to this emergency case.')
        }

        await changeStatus(
          client,
          emg.id,
          targetStatus,
          { id: req.user!.id, role: 'driver' },
          note
        )

        return getEmergencyCase(emg.case_code, { id: req.user!.id, role: req.user!.role }, client)
      })

      // Emit status updates
      emitToRoom('role:admin', 'case:status', {
        caseId: updatedCase.id,
        status: targetStatus,
        changedBy: req.user!.id,
        note,
        timestamp: new Date().toISOString(),
      })

      emitToRoom(`case:${updatedCase.id}`, 'case:status', {
        caseId: updatedCase.id,
        status: targetStatus,
        changedBy: req.user!.id,
        note,
        timestamp: new Date().toISOString(),
      })

      res.json(updatedCase)
    } catch (err) {
      next(err)
    }
  }
)
