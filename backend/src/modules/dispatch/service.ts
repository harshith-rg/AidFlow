import { pool, withTransaction } from '../../db/pool'
import { conflict, forbidden, notFound } from '../../utils/errors'
import { logger } from '../../utils/logger'
import { changeStatus } from '../emergencies/stateMachine'
import { getEmergencyCase } from '../emergencies/emergencies.service'
import { recommendHospital } from '../routing/recommend'
import { cancelAttemptTimeout } from './scheduler'
import { offerNext } from './engine'
import { emitToRoom, emitToAll } from '../../realtime/events'
import type { EmergencyCase } from '../../types/contract'

export async function acceptAttempt(
  attemptId: string,
  actorUserId?: string | null
): Promise<EmergencyCase> {
  let caseCode: string = ''
  let ambulanceId: string = ''
  let hospitalId: string | null = null
  let etaMinutes: number = 0
  let emergencyType: string = ''
  let severity: string = ''

  await withTransaction(async (client) => {
    // 1. Lock dispatch attempt FOR UPDATE
    const attemptRes = await client.query(
      `SELECT da.id, da.emergency_id, da.ambulance_id, da.attempt_no, da.outcome, da.expires_at,
              e.case_code, e.pickup_lat, e.pickup_lng, e.type, e.severity, e.status as case_status,
              a.label as amb_label, a.driver_id, a.status as amb_status
       FROM dispatch_attempts da
       JOIN emergencies e ON da.emergency_id = e.id
       JOIN ambulances a ON da.ambulance_id = a.id
       WHERE da.id = $1
       FOR UPDATE`,
      [attemptId]
    )

    if (attemptRes.rows.length === 0) {
      throw notFound('Dispatch attempt')
    }

    const row = attemptRes.rows[0]
    caseCode = row.case_code
    ambulanceId = row.ambulance_id
    emergencyType = row.type
    severity = row.severity

    // 2. Validate pending status and non-expired
    const now = new Date()
    if (row.outcome !== 'pending' || new Date(row.expires_at) <= now) {
      throw conflict('Offer has expired or was already answered.')
    }

    // 3. Driver authorization
    if (actorUserId && row.driver_id && row.driver_id !== actorUserId) {
      // Check if actor is an admin
      const userRes = await client.query('SELECT role FROM users WHERE id = $1', [actorUserId])
      const userRole = userRes.rows[0]?.role
      if (userRole !== 'admin') {
        throw forbidden('You are not authorized to accept this dispatch offer.')
      }
    }

    // 4. Mark attempt accepted
    await client.query(
      `UPDATE dispatch_attempts
       SET outcome = 'accepted', responded_at = now()
       WHERE id = $1`,
      [attemptId]
    )

    // 5. Run hospital recommendation pipeline
    const pickup = { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) }
    const recResult = await recommendHospital({
      pickup,
      emergencyType: row.type,
      severity: row.severity,
      client,
    })

    const chosenHospital = recResult.recommended?.hospital
    hospitalId = chosenHospital ? chosenHospital.id : null
    etaMinutes = recResult.etaMinutes || 10

    // 6. Mark ambulance busy
    await client.query(
      `UPDATE ambulances SET status = 'busy', updated_at = now() WHERE id = $1`,
      [row.ambulance_id]
    )

    // 7. Update emergency record
    await client.query(
      `UPDATE emergencies
       SET assigned_ambulance_id = $1,
           hospital_id = $2,
           hospital_reason = $3,
           eta_minutes = $4,
           route_polyline = $5,
           route_distance_km = $6,
           eta_source = $7,
           updated_at = now()
       WHERE id = $8`,
      [
        row.ambulance_id,
        hospitalId,
        recResult.reason,
        etaMinutes,
        JSON.stringify(recResult.geometry),
        recResult.distanceKm,
        recResult.etaSource,
        row.emergency_id,
      ]
    )

    // 8. Atomic status transition
    await changeStatus(
      client,
      row.emergency_id,
      'assigned',
      { id: actorUserId || row.driver_id, role: 'driver' },
      `Offer accepted by ambulance ${row.amb_label}`
    )
  })

  // Cancel in-memory timer
  cancelAttemptTimeout(attemptId)

  // POST-COMMIT EMITS
  emitToRoom(`driver:${ambulanceId}`, 'dispatch:accepted', {
    attemptId,
    caseId: caseCode,
    ambulanceId,
    driverId: actorUserId || undefined,
  })

  emitToRoom('role:admin', 'case:status', {
    caseId: caseCode,
    status: 'assigned',
    note: `Ambulance assigned to case ${caseCode}`,
    timestamp: new Date().toISOString(),
  })

  if (hospitalId) {
    emitToRoom(`hospital:${hospitalId}`, 'hospital:incoming', {
      hospitalId,
      caseId: caseCode,
      ambulanceId,
      etaMinutes,
      emergencyType,
      severity,
    })
  }

  // End linked call session
  await pool.query(
    `UPDATE call_sessions
     SET status = 'completed', ended_at = now(), end_reason = 'accepted_by_driver'
     WHERE dispatch_attempt_id = $1 AND status IN ('ringing', 'in_progress')`,
    [attemptId]
  )

  return getEmergencyCase(caseCode)
}

export async function rejectAttempt(
  attemptId: string,
  actorUserId?: string | null,
  reason?: string
): Promise<void> {
  let caseCode: string = ''
  let ambulanceId: string = ''

  await withTransaction(async (client) => {
    const attemptRes = await client.query(
      `SELECT da.id, da.emergency_id, da.ambulance_id, da.outcome, da.expires_at,
              e.case_code, a.driver_id, a.label
       FROM dispatch_attempts da
       JOIN emergencies e ON da.emergency_id = e.id
       JOIN ambulances a ON da.ambulance_id = a.id
       WHERE da.id = $1
       FOR UPDATE`,
      [attemptId]
    )

    if (attemptRes.rows.length === 0) {
      throw notFound('Dispatch attempt')
    }

    const row = attemptRes.rows[0]
    caseCode = row.case_code
    ambulanceId = row.ambulance_id

    if (row.outcome !== 'pending') {
      throw conflict('Offer is no longer pending.')
    }

    // Driver authorization check
    if (actorUserId && row.driver_id && row.driver_id !== actorUserId) {
      const userRes = await client.query('SELECT role FROM users WHERE id = $1', [actorUserId])
      if (userRes.rows[0]?.role !== 'admin') {
        throw forbidden('You are not authorized to reject this offer.')
      }
    }

    // Mark attempt rejected
    await client.query(
      `UPDATE dispatch_attempts
       SET outcome = 'rejected', responded_at = now()
       WHERE id = $1`,
      [attemptId]
    )

    // Record history
    await client.query(
      `INSERT INTO emergency_status_history (emergency_id, from_status, to_status, changed_by, note)
       VALUES ($1, 'offered', 'offered', $2, $3)`,
      [row.emergency_id, actorUserId || row.driver_id, `Rejected by ambulance ${row.label}: ${reason || 'No reason specified'}`]
    )
  })

  cancelAttemptTimeout(attemptId)

  emitToRoom(`driver:${ambulanceId}`, 'dispatch:rejected', {
    attemptId,
    caseId: caseCode,
    ambulanceId,
    reason,
  })

  // End linked call session
  await pool.query(
    `UPDATE call_sessions
     SET status = 'completed', ended_at = now(), end_reason = 'rejected_by_driver'
     WHERE dispatch_attempt_id = $1 AND status IN ('ringing', 'in_progress')`,
    [attemptId]
  )

  // Proceed immediately to next candidate
  try {
    await offerNext(caseCode)
  } catch (err) {
    logger.error({ err, caseCode }, 'Failed to offer next candidate after reject')
  }
}

export async function timeoutAttempt(attemptId: string): Promise<void> {
  let caseCode: string = ''
  let ambulanceId: string = ''

  await withTransaction(async (client) => {
    const attemptRes = await client.query(
      `SELECT da.id, da.emergency_id, da.ambulance_id, da.outcome,
              e.case_code, a.label
       FROM dispatch_attempts da
       JOIN emergencies e ON da.emergency_id = e.id
       JOIN ambulances a ON da.ambulance_id = a.id
       WHERE da.id = $1
       FOR UPDATE`,
      [attemptId]
    )

    if (attemptRes.rows.length === 0) return

    const row = attemptRes.rows[0]
    if (row.outcome !== 'pending') return

    caseCode = row.case_code
    ambulanceId = row.ambulance_id

    // Mark attempt timed_out
    await client.query(
      `UPDATE dispatch_attempts
       SET outcome = 'timed_out', responded_at = now()
       WHERE id = $1`,
      [attemptId]
    )

    // Record history
    await client.query(
      `INSERT INTO emergency_status_history (emergency_id, from_status, to_status, note)
       VALUES ($1, 'offered', 'offered', $2)`,
      [row.emergency_id, `Dispatch attempt for ambulance ${row.label} timed out with no response`]
    )
  })

  cancelAttemptTimeout(attemptId)

  if (caseCode) {
    emitToRoom(`driver:${ambulanceId}`, 'dispatch:timeout', {
      attemptId,
      caseId: caseCode,
      ambulanceId,
    })

    // End call session as missed
    await pool.query(
      `UPDATE call_sessions
       SET status = 'missed', ended_at = now(), end_reason = 'timed_out'
       WHERE dispatch_attempt_id = $1 AND status IN ('ringing', 'in_progress')`,
      [attemptId]
    )

    // Offer next candidate
    try {
      await offerNext(caseCode)
    } catch (err) {
      logger.error({ err, caseCode }, 'Failed to offer next candidate after timeout')
    }
  }
}
