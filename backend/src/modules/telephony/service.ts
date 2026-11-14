import { pool, withTransaction } from '../../db/pool'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { notFound, conflict, forbidden, badRequest } from '../../utils/errors'
import { emitToRoom, emitToAll } from '../../realtime/events'
import { createEmergencyCase } from '../emergencies/emergencies.service'
import { acceptAttempt, rejectAttempt } from '../dispatch/service'
import { registerOutboundCallHook } from '../dispatch/engine'
import type { EmergencyCase } from '../../types/contract'

export interface CallSession {
  id: string
  direction: 'inbound_caller' | 'outbound_driver'
  from_number: string
  to_number: string
  caller_name: string | null
  status: 'ringing' | 'in_progress' | 'completed' | 'missed' | 'failed'
  emergency_id: string | null
  ambulance_id: string | null
  dispatch_attempt_id: string | null
  answered_by: string | null
  dtmf_input: string | null
  simulated: boolean
  started_at: Date
  answered_at: Date | null
  ended_at: Date | null
  end_reason: string | null
}

export interface CallEvent {
  id: string
  call_session_id: string
  type: string
  payload: any
  at: Date
}

/**
 * Creates an incoming caller session to the dummy helpline.
 */
export async function createIncomingCall(data: {
  callerNumber: string
  callerName?: string
  lat?: number
  lng?: number
}): Promise<CallSession> {
  const helplineNumber = env.HELPLINE_DEMO_NUMBER || '1800-000-0000'
  const ringTimeoutMs = env.CALL_RING_TIMEOUT_MS || 30000

  const res = await pool.query(
    `INSERT INTO call_sessions (
       direction, from_number, to_number, caller_name, status, simulated
     )
     VALUES ('inbound_caller', $1, $2, $3, 'ringing', TRUE)
     RETURNING *`,
    [data.callerNumber, helplineNumber, data.callerName || 'Anonymous Caller']
  )

  const session: CallSession = res.rows[0]

  // Record call event
  await pool.query(
    `INSERT INTO call_events (call_session_id, type, payload)
     VALUES ($1, 'ringing', $2)`,
    [session.id, JSON.stringify({ lat: data.lat, lng: data.lng })]
  )

  // Emit to admin control room operators
  emitToRoom('role:admin', 'call:incoming', {
    callSessionId: session.id,
    direction: 'inbound_caller',
    fromNumber: session.from_number,
    toNumber: session.to_number,
    callerName: session.caller_name,
    simulated: true,
    prompt: `Incoming simulated helpline call from ${session.caller_name} (${session.from_number})`,
  })

  // Auto-mark missed if not answered within ring timeout
  setTimeout(async () => {
    try {
      const checkRes = await pool.query(
        `SELECT status FROM call_sessions WHERE id = $1`,
        [session.id]
      )
      if (checkRes.rows[0]?.status === 'ringing') {
        await pool.query(
          `UPDATE call_sessions
           SET status = 'missed', ended_at = now(), end_reason = 'ring_timeout'
           WHERE id = $1`,
          [session.id]
        )
        await pool.query(
          `INSERT INTO call_events (call_session_id, type, payload)
           VALUES ($1, 'missed', '{"reason": "ring_timeout"}')`,
          [session.id]
        )
        emitToRoom('role:admin', 'call:ended', {
          callSessionId: session.id,
          status: 'missed',
          endReason: 'ring_timeout',
        })
      }
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'Error auto-marking missed call')
    }
  }, ringTimeoutMs).unref()

  return session
}

/**
 * Answers an inbound call session by a control room operator.
 */
export async function answerCall(callId: string, answeredByUserId: string): Promise<CallSession> {
  const checkRes = await pool.query(`SELECT * FROM call_sessions WHERE id = $1`, [callId])
  if (checkRes.rows.length === 0) {
    throw notFound('Call session')
  }

  const current = checkRes.rows[0]
  if (current.status !== 'ringing') {
    throw conflict(`Cannot answer call in status '${current.status}'.`)
  }

  const res = await pool.query(
    `UPDATE call_sessions
     SET status = 'in_progress', answered_by = $1, answered_at = now(), updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [answeredByUserId, callId]
  )

  const updated: CallSession = res.rows[0]

  await pool.query(
    `INSERT INTO call_events (call_session_id, type, payload)
     VALUES ($1, 'answered', $2)`,
    [callId, JSON.stringify({ answeredBy: answeredByUserId })]
  )

  emitToRoom('role:admin', 'call:updated', {
    callSessionId: updated.id,
    status: 'in_progress',
    answeredBy: answeredByUserId,
  })

  return updated
}

/**
 * Registers an emergency case from an active call session.
 */
export async function registerEmergencyFromCall(
  callId: string,
  emergencyData: any,
  adminUser: { id: string; role: 'admin' }
): Promise<EmergencyCase> {
  const callRes = await pool.query(`SELECT * FROM call_sessions WHERE id = $1`, [callId])
  if (callRes.rows.length === 0) {
    throw notFound('Call session')
  }

  const call = callRes.rows[0]
  if (call.status !== 'in_progress' && call.status !== 'ringing') {
    throw conflict(`Cannot register emergency from call in status '${call.status}'.`)
  }

  // Create emergency case with source 'call' and callSessionId
  const emgCase = await createEmergencyCase(
    {
      ...emergencyData,
      source: 'call',
      callSessionId: callId,
    },
    { id: adminUser.id, role: 'admin' }
  )

  // Update call session
  await pool.query(
    `UPDATE call_sessions
     SET emergency_id = (SELECT id FROM emergencies WHERE case_code = $1), updated_at = now()
     WHERE id = $2`,
    [emgCase.id, callId]
  )

  await pool.query(
    `INSERT INTO call_events (call_session_id, type, payload)
     VALUES ($1, 'emergency_registered', $2)`,
    [callId, JSON.stringify({ caseId: emgCase.id })]
  )

  return emgCase
}

/**
 * Ends a call session.
 */
export async function endCall(callId: string, endReason = 'call_ended'): Promise<CallSession> {
  const check = await pool.query(`SELECT * FROM call_sessions WHERE id = $1`, [callId])
  if (check.rows.length === 0) {
    throw notFound('Call session')
  }

  const res = await pool.query(
    `UPDATE call_sessions
     SET status = 'completed', ended_at = now(), end_reason = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [endReason, callId]
  )

  const ended: CallSession = res.rows[0]

  await pool.query(
    `INSERT INTO call_events (call_session_id, type, payload)
     VALUES ($1, 'ended', $2)`,
    [callId, JSON.stringify({ reason: endReason })]
  )

  emitToAll('call:ended', {
    callSessionId: ended.id,
    status: 'completed',
    endReason,
  })

  return ended
}

/**
 * Handles driver DTMF keypad digit input (1 = Accept, 2 = Reject).
 */
export async function handleDriverDtmf(
  callId: string,
  digit: string,
  driverUserId: string
): Promise<{ action: 'accepted' | 'rejected' | 'ignored'; message: string; case?: EmergencyCase }> {
  const callRes = await pool.query(
    `SELECT cs.*, a.driver_id, a.label as amb_label
     FROM call_sessions cs
     JOIN ambulances a ON cs.ambulance_id = a.id
     WHERE cs.id = $1`,
    [callId]
  )

  if (callRes.rows.length === 0) {
    throw notFound('Call session')
  }

  const call = callRes.rows[0]

  if (call.direction !== 'outbound_driver') {
    throw badRequest('DTMF input is only valid on outbound driver IVR calls.')
  }

  if (call.status !== 'ringing' && call.status !== 'in_progress') {
    throw conflict(`Call is already ${call.status}.`)
  }

  // Driver authorization
  if (call.driver_id !== driverUserId) {
    // Check if admin override
    const userRes = await pool.query('SELECT role FROM users WHERE id = $1', [driverUserId])
    if (userRes.rows[0]?.role !== 'admin') {
      throw forbidden('You are not authorized to respond to this driver call.')
    }
  }

  // Record DTMF input
  await pool.query(
    `UPDATE call_sessions
     SET dtmf_input = $1, updated_at = now()
     WHERE id = $2`,
    [digit, callId]
  )

  await pool.query(
    `INSERT INTO call_events (call_session_id, type, payload)
     VALUES ($1, 'digit_pressed', $2)`,
    [callId, JSON.stringify({ digit })]
  )

  if (digit === '1') {
    // Accept attempt
    const assignedCase = await acceptAttempt(call.dispatch_attempt_id, driverUserId)
    await pool.query(
      `UPDATE call_sessions
       SET status = 'completed', ended_at = now(), end_reason = 'driver_accepted_via_dtmf'
       WHERE id = $1`,
      [callId]
    )
    return { action: 'accepted', message: 'Offer accepted via DTMF 1', case: assignedCase }
  } else if (digit === '2') {
    // Reject attempt
    await rejectAttempt(call.dispatch_attempt_id, driverUserId, 'Driver rejected via DTMF digit 2')
    await pool.query(
      `UPDATE call_sessions
       SET status = 'completed', ended_at = now(), end_reason = 'driver_rejected_via_dtmf'
       WHERE id = $1`,
      [callId]
    )
    return { action: 'rejected', message: 'Offer rejected via DTMF 2' }
  }

  return { action: 'ignored', message: `Keypad digit '${digit}' logged; waiting for 1 (accept) or 2 (reject)` }
}

/**
 * Creates outbound driver IVR call when a dispatch offer is made.
 */
export async function createOutboundDriverCall(
  attemptId: string,
  emergencyId: string,
  ambulanceId: string,
  driverId: string | null
): Promise<void> {
  const helplineNumber = env.HELPLINE_DEMO_NUMBER || '1800-000-0000'

  // De-duplicate: don't create multiple call sessions for the same attempt
  const existing = await pool.query(
    `SELECT id FROM call_sessions WHERE dispatch_attempt_id = $1`,
    [attemptId]
  )
  if (existing.rows.length > 0) {
    return
  }

  // Query driver phone
  let driverPhone = '9999999999'
  if (driverId) {
    const uRes = await pool.query('SELECT phone FROM users WHERE id = $1', [driverId])
    if (uRes.rows[0]?.phone) driverPhone = uRes.rows[0].phone
  }

  const res = await pool.query(
    `INSERT INTO call_sessions (
       direction, from_number, to_number, status, emergency_id, ambulance_id, dispatch_attempt_id, simulated
     )
     VALUES ('outbound_driver', $1, $2, 'ringing', $3, $4, $5, TRUE)
     ON CONFLICT (dispatch_attempt_id) WHERE dispatch_attempt_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [helplineNumber, driverPhone, emergencyId, ambulanceId, attemptId]
  )

  if (res.rows.length === 0) {
    return
  }

  const session = res.rows[0]

  await pool.query(
    `INSERT INTO call_events (call_session_id, type, payload)
     VALUES ($1, 'ringing', '{"direction": "outbound_driver"}')`,
    [session.id]
  )

  emitToRoom(`driver:${ambulanceId}`, 'call:incoming', {
    callSessionId: session.id,
    direction: 'outbound_driver',
    fromNumber: helplineNumber,
    toNumber: driverPhone,
    emergencyId,
    ambulanceId,
    simulated: true,
    prompt: 'Emergency request near you. Press 1 to accept, press 2 to reject.',
  })
}

// Hook registration
registerOutboundCallHook(createOutboundDriverCall)
