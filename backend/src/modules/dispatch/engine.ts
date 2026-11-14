import { pool, withTransaction } from '../../db/pool'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { rankCandidateAmbulances } from './ranking'
import { changeStatus } from '../emergencies/stateMachine'
import { scheduleAttemptTimeout } from './scheduler'
import { emitToRoom, emitToAll } from '../../realtime/events'

export interface DispatchOffer {
  attemptId: string
  attemptNo: number
  emergencyId: string
  caseCode: string
  ambulanceId: string
  driverId: string | null
  expiresAt: Date
  pickup: { lat: number; lng: number }
  emergencyType: string
  severity: string
  etaMinutes: number
}

// Hook for IVR outbound telephony call
type OutboundCallHook = (
  attemptId: string,
  emergencyId: string,
  ambulanceId: string,
  driverId: string | null
) => Promise<void>

let outboundCallHook: OutboundCallHook | null = null

export function registerOutboundCallHook(hook: OutboundCallHook) {
  outboundCallHook = hook
}

/**
 * Initiates the dispatch process for a case or transitions to the next available candidate.
 */
export async function offerNext(caseCodeOrId: string): Promise<DispatchOffer | null> {
  const timeoutMs = env.DISPATCH_TIMEOUT_MS || 20000

  const txResult = await withTransaction(async (client) => {
    let innerOffer: DispatchOffer | null = null
    let innerAlert: { id: string; message: string; createdAt: string } | null = null
    let innerRetry = false

    // 1. Lock emergency case FOR UPDATE
    const caseRes = await client.query(
      `SELECT id, case_code, pickup_lat, pickup_lng, type, severity, status, retry_count
       FROM emergencies
       WHERE case_code = $1 OR id::text = $1
       FOR UPDATE`,
      [caseCodeOrId]
    )

    if (caseRes.rows.length === 0) {
      logger.warn({ caseCodeOrId }, 'offerNext: case not found')
      return { offerResult: null, noAmbulanceAlert: null, retryScheduled: false }
    }

    const emg = caseRes.rows[0]

    // If case is in terminal state or already assigned/en_route, stop dispatch
    if (['assigned', 'en_route', 'reached_patient', 'heading_to_hospital', 'handed_over', 'completed', 'cancelled'].includes(emg.status)) {
      logger.info({ caseCode: emg.case_code, status: emg.status }, 'offerNext: case already active or terminal, halting offers')
      return { offerResult: null, noAmbulanceAlert: null, retryScheduled: false }
    }

    const pickup = { lat: Number(emg.pickup_lat), lng: Number(emg.pickup_lng) }

    // Check if there is already a pending attempt for this case
    const pendingRes = await client.query(
      `SELECT da.id, da.ambulance_id, da.attempt_no, da.offered_at, da.expires_at, a.driver_id, a.label
       FROM dispatch_attempts da
       JOIN ambulances a ON da.ambulance_id = a.id
       WHERE da.emergency_id = $1 AND da.outcome = 'pending'`,
      [emg.id]
    )
    if (pendingRes.rows.length > 0) {
      const p = pendingRes.rows[0]
      innerOffer = {
        attemptId: p.id,
        attemptNo: Number(p.attempt_no),
        emergencyId: emg.id,
        caseCode: emg.case_code,
        ambulanceId: p.ambulance_id,
        driverId: p.driver_id,
        expiresAt: new Date(p.expires_at),
        pickup,
        emergencyType: emg.type,
        severity: emg.severity,
        etaMinutes: 1,
      }
      return { offerResult: innerOffer, noAmbulanceAlert: null, retryScheduled: false }
    }

    // 2. Query candidates not yet attempted
    let candidates = await rankCandidateAmbulances(client, emg.id, pickup, false)

    // If no candidate and retries allowed, allow previously attempted ambulances in a new round
    if (candidates.length === 0 && emg.retry_count < (env.DISPATCH_MAX_RETRIES || 5)) {
      candidates = await rankCandidateAmbulances(client, emg.id, pickup, true)
    }

    // 3. If still no eligible ambulance:
    if (candidates.length === 0) {
      const nextRetry = emg.retry_count + 1
      const maxRetries = env.DISPATCH_MAX_RETRIES || 5

      // Transition back to waiting if was offered
      if (emg.status === 'offered') {
        await changeStatus(client, emg.id, 'waiting', { id: null, role: 'admin' }, 'No eligible ambulance available; returned to waiting queue')
      }

      if (nextRetry <= maxRetries) {
        await client.query(
          `UPDATE emergencies
           SET retry_count = $1, next_retry_at = now() + ($2 || ' milliseconds')::interval, updated_at = now()
           WHERE id = $3`,
          [nextRetry, env.DISPATCH_RETRY_MS || 30000, emg.id]
        )
        innerRetry = true
      }

      // Raise system alert for control room
      const alertMsg = nextRetry <= maxRetries
        ? `No available ambulances within ${env.DISPATCH_RADIUS_KM || 50}km for case ${emg.case_code}. Retry round ${nextRetry}/${maxRetries} scheduled in ${(env.DISPATCH_RETRY_MS || 30000) / 1000}s.`
        : `CRITICAL: Maximum dispatch retries (${maxRetries}) exhausted for case ${emg.case_code}. Manual ambulance assignment required.`

      const alertRes = await client.query(
        `INSERT INTO alerts (type, message, emergency_id, target_role, acknowledged)
         VALUES ('no_ambulance', $1, $2, 'admin', FALSE)
         RETURNING id, message, created_at`,
        [alertMsg, emg.id]
      )

      innerAlert = {
        id: alertRes.rows[0].id,
        message: alertRes.rows[0].message,
        createdAt: alertRes.rows[0].created_at.toISOString(),
      }

      logger.warn({ caseCode: emg.case_code, retryCount: nextRetry }, 'No ambulances available for case')
      return { offerResult: null, noAmbulanceAlert: innerAlert, retryScheduled: innerRetry }
    }

    // 4. Select top candidate
    const chosen = candidates[0]

    // Determine attempt number
    const maxAttemptRes = await client.query(
      `SELECT coalesce(max(attempt_no), 0) AS max_attempt FROM dispatch_attempts WHERE emergency_id = $1`,
      [emg.id]
    )
    const nextAttemptNo = Number(maxAttemptRes.rows[0].max_attempt) + 1

    const expiresAt = new Date(Date.now() + timeoutMs)
    const via = env.TELEPHONY_PROVIDER === 'simulated' ? 'call' : 'app'

    // Insert dispatch attempt
    const attemptRes = await client.query(
      `INSERT INTO dispatch_attempts (emergency_id, ambulance_id, attempt_no, outcome, offered_at, expires_at, via)
       VALUES ($1, $2, $3, 'pending', now(), $4, $5)
       RETURNING id, offered_at, expires_at`,
      [emg.id, chosen.id, nextAttemptNo, expiresAt, via]
    )

    const attempt = attemptRes.rows[0]

    // Update case status to 'offered'
    if (emg.status !== 'offered') {
      await changeStatus(
        client,
        emg.id,
        'offered',
        { id: null, role: 'admin' },
        `Offered to ambulance ${chosen.label} (attempt #${nextAttemptNo}, ~${chosen.etaMinutes ?? 1} min ETA)`
      )
    }

    innerOffer = {
      attemptId: attempt.id,
      attemptNo: nextAttemptNo,
      emergencyId: emg.id,
      caseCode: emg.case_code,
      ambulanceId: chosen.id,
      driverId: chosen.driver_id,
      expiresAt: new Date(attempt.expires_at),
      pickup,
      emergencyType: emg.type,
      severity: emg.severity,
      etaMinutes: chosen.etaMinutes || 1,
    }

    return { offerResult: innerOffer, noAmbulanceAlert: null, retryScheduled: false }
  })

  const { offerResult, noAmbulanceAlert, retryScheduled } = txResult

  // POST-COMMIT ACTIONS
  if (offerResult) {
    // Schedule timeout
    scheduleAttemptTimeout(offerResult.attemptId, offerResult.expiresAt)

    // Emit event to driver room
    emitToRoom(`driver:${offerResult.ambulanceId}`, 'dispatch:offered', {
      attemptId: offerResult.attemptId,
      caseId: offerResult.caseCode,
      ambulanceId: offerResult.ambulanceId,
      expiresAt: offerResult.expiresAt.toISOString(),
      pickup: offerResult.pickup,
      emergencyType: offerResult.emergencyType,
      severity: offerResult.severity,
      etaMinutes: offerResult.etaMinutes,
    })

    // Emit to admin control room
    emitToRoom('role:admin', 'case:status', {
      caseId: offerResult.caseCode,
      status: 'offered',
      note: `Dispatch offer #${offerResult.attemptNo} sent to ambulance ${offerResult.ambulanceId}`,
      timestamp: new Date().toISOString(),
    })

    // Initiate simulated IVR call if telephony is active
    if (outboundCallHook) {
      try {
        await outboundCallHook(
          offerResult.attemptId,
          offerResult.emergencyId,
          offerResult.ambulanceId,
          offerResult.driverId
        )
      } catch (err) {
        logger.error({ err }, 'Outbound IVR hook failed')
      }
    }
  }

  if (noAmbulanceAlert) {
    emitToRoom('role:admin', 'alert:new', {
      id: noAmbulanceAlert.id,
      type: 'no_ambulance',
      message: noAmbulanceAlert.message,
      createdAt: noAmbulanceAlert.createdAt,
      targetRole: 'admin',
    })
  }

  if (retryScheduled) {
    setTimeout(() => {
      offerNext(caseCodeOrId).catch((err) =>
        logger.error({ err, caseCodeOrId }, 'Scheduled dispatch retry failed')
      )
    }, env.DISPATCH_RETRY_MS || 30000).unref()
  }

  return offerResult
}

export async function startDispatch(caseCodeOrId: string): Promise<DispatchOffer | null> {
  return offerNext(caseCodeOrId)
}
