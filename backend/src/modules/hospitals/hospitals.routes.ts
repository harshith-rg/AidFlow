import { Router } from 'express'
import { pool } from '../../db/pool'
import { requireAuth } from '../../middleware/auth'
import { badRequest, forbidden, notFound } from '../../utils/errors'
import { recommendHospital } from '../routing/recommend'
import type { Hospital, EmergencyTypeId, Severity } from '../../types/contract'

export const hospitalsRouter = Router()

// Maps a DB row to the Hospital shape in contract.ts (camelCase, ISO timestamps).
function toHospital(r: Record<string, any>): Hospital {
  return {
    id: r.id,
    name: r.name,
    address: r.address ?? undefined,
    phone: r.phone ?? undefined,
    category: r.category ?? undefined,
    lat: r.lat,
    lng: r.lng,
    capacityStatus: r.capacity_status,
    beds: r.beds ?? undefined,
    icuBeds: r.icu_beds ?? undefined,
    lastUpdated: r.last_updated ? new Date(r.last_updated).toISOString() : undefined,
  }
}

// GET /hospitals: the first real endpoint; the frontend's listHospitals() already calls this path.
hospitalsRouter.get('/hospitals', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM hospitals WHERE is_operational = TRUE ORDER BY name')
    res.json(rows.map(toHospital))
  } catch (err) {
    next(err)
  }
})

// GET /hospitals/recommend: AI recommendation pipeline
hospitalsRouter.get('/hospitals/recommend', requireAuth, async (req, res, next) => {
  try {
    const lat = Number(req.query.lat)
    const lng = Number(req.query.lng)
    const type = (req.query.type as EmergencyTypeId) || 'other'
    const severity = (req.query.severity as Severity) || 'high'

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw badRequest('Valid lat and lng query parameters are required.')
    }

    const result = await recommendHospital({
      pickup: { lat, lng },
      emergencyType: type,
      severity,
    })

    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /hospitals/:id/status
hospitalsRouter.get('/hospitals/:id/status', requireAuth, async (req, res, next) => {
  try {
    const hospitalId = req.params.id
    if (req.user!.role === 'hospital' && req.user!.hospitalId !== hospitalId) {
      throw forbidden('You can only view your assigned hospital status.')
    }

    const hospRes = await pool.query('SELECT * FROM hospitals WHERE id = $1', [hospitalId])
    if (hospRes.rows.length === 0) {
      throw notFound('Hospital')
    }

    res.json(toHospital(hospRes.rows[0]))
  } catch (err) {
    next(err)
  }
})

// PATCH /hospitals/:id/status: update capacity, bed counts, operational state
hospitalsRouter.patch('/hospitals/:id/status', requireAuth, async (req, res, next) => {
  try {
    const hospitalId = req.params.id
    if (req.user!.role !== 'admin' && (req.user!.role !== 'hospital' || req.user!.hospitalId !== hospitalId)) {
      throw forbidden('You are not authorized to update this hospital status.')
    }

    const { capacity_status, beds, icu_beds, is_operational } = req.body

    const updates: string[] = ['last_updated = now()']
    const values: any[] = []

    if (capacity_status !== undefined) {
      values.push(capacity_status)
      updates.push(`capacity_status = $${values.length}`)
    }
    if (beds !== undefined) {
      values.push(beds)
      updates.push(`beds = $${values.length}`)
    }
    if (icu_beds !== undefined) {
      values.push(icu_beds)
      updates.push(`icu_beds = $${values.length}`)
    }
    if (is_operational !== undefined) {
      values.push(is_operational)
      updates.push(`is_operational = $${values.length}`)
    }

    values.push(hospitalId)
    const updateRes = await pool.query(
      `UPDATE hospitals SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    )

    if (updateRes.rows.length === 0) {
      throw notFound('Hospital')
    }

    res.json(toHospital(updateRes.rows[0]))
  } catch (err) {
    next(err)
  }
})

// GET /hospitals/:id/incoming: cases heading to this hospital
hospitalsRouter.get('/hospitals/:id/incoming', requireAuth, async (req, res, next) => {
  try {
    const hospitalId = req.params.id
    if (req.user!.role === 'hospital' && req.user!.hospitalId !== hospitalId) {
      throw forbidden('You can only view incoming cases for your assigned hospital.')
    }

    const resCases = await pool.query(
      `SELECT e.*, a.label as amb_label, a.vehicle_number as amb_vehicle_number, u.name as driver_name
       FROM emergencies e
       LEFT JOIN ambulances a ON e.assigned_ambulance_id = a.id
       LEFT JOIN users u ON a.driver_id = u.id
       WHERE e.hospital_id = $1
         AND e.status IN ('assigned', 'en_route', 'reached_patient', 'heading_to_hospital')
       ORDER BY e.eta_minutes ASC NULLS LAST`,
      [hospitalId]
    )

    res.json(
      resCases.rows.map((r) => ({
        id: r.case_code,
        type: r.type,
        severity: r.severity,
        status: r.status,
        etaMinutes: r.eta_minutes,
        reporterName: r.reporter_name,
        reporterPhone: r.reporter_phone,
        pickupAddress: r.pickup_address,
        ambulanceLabel: r.amb_label,
        driverName: r.driver_name,
        updatedAt: r.updated_at,
      }))
    )
  } catch (err) {
    next(err)
  }
})

// POST /hospitals/:id/ack/:caseId: acknowledge incoming emergency transfer
hospitalsRouter.post('/hospitals/:id/ack/:caseId', requireAuth, async (req, res, next) => {
  try {
    const { id: hospitalId, caseId } = req.params
    if (req.user!.role !== 'admin' && (req.user!.role !== 'hospital' || req.user!.hospitalId !== hospitalId)) {
      throw forbidden('You are not authorized to acknowledge transfers for this hospital.')
    }

    const caseRes = await pool.query(
      'SELECT id, case_code FROM emergencies WHERE case_code = $1 OR id::text = $1',
      [caseId]
    )
    if (caseRes.rows.length === 0) {
      throw notFound('Emergency case')
    }

    const emg = caseRes.rows[0]

    // Record status history note
    await pool.query(
      `INSERT INTO emergency_status_history (emergency_id, from_status, to_status, changed_by, note)
       VALUES ($1, 'heading_to_hospital', 'heading_to_hospital', $2, 'Hospital acknowledged incoming patient preparation')`,
      [emg.id, req.user!.id]
    )

    // Record notification alert
    const alertRes = await pool.query(
      `INSERT INTO alerts (type, message, emergency_id, hospital_id, target_role, acknowledged)
       VALUES ('hospital', $1, $2, $3, 'admin', TRUE)
       RETURNING *`,
      [`Hospital acknowledged incoming preparation for case ${emg.case_code}`, emg.id, hospitalId]
    )

    res.json({ message: 'Emergency transfer acknowledged', alert: alertRes.rows[0] })
  } catch (err) {
    next(err)
  }
})
