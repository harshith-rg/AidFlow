import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../../db/pool'
import {
  EMERGENCY_TYPES,
  type CaseStatus,
  type CreateEmergencyInput,
  type EmergencyCase,
  type EmergencyTypeId,
  type Role,
  type Severity,
} from '../../types/contract'
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors'
import { logger } from '../../utils/logger'
import { toEmergencyCase } from './emergencies.mapper'
import { changeStatus } from './stateMachine'

export interface ActorInfo {
  id: string | null
  role: Role
  hospitalId?: string | null
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

export function getDefaultSeverity(type: EmergencyTypeId): Severity {
  const match = EMERGENCY_TYPES.find((t) => t.id === type)
  return match ? match.severity : 'medium'
}

export async function createEmergencyCase(
  input: CreateEmergencyInput & {
    source?: 'web' | 'call' | 'manual'
    severity?: Severity
    callSessionId?: string | null
  },
  actor: ActorInfo
): Promise<EmergencyCase> {
  const normalizedPhone = normalizePhone(input.reporterPhone)
  if (normalizedPhone.length !== 10) {
    throw badRequest('Reporter phone must be a valid 10-digit phone number.')
  }

  const reporterName = input.reporterName.trim()
  if (reporterName.length < 2) {
    throw badRequest('Reporter name must be at least 2 characters.')
  }

  const validTypes = EMERGENCY_TYPES.map((t) => t.id)
  if (!validTypes.includes(input.type)) {
    throw badRequest(`Invalid emergency type '${input.type}'.`)
  }

  const severity: Severity =
    actor.role === 'admin' && input.severity ? input.severity : getDefaultSeverity(input.type)

  const source = input.source || 'web'

  // Duplicate submission prevention: same phone + type + pickup (within ~50m) in last 60s
  const duplicateCheck = await pool.query(
    `SELECT case_code, created_at FROM emergencies
     WHERE reporter_phone = $1
       AND type = $2
       AND abs(pickup_lat - $3) < 0.0005
       AND abs(pickup_lng - $4) < 0.0005
       AND created_at > now() - INTERVAL '60 seconds'
     ORDER BY created_at DESC LIMIT 1`,
    [normalizedPhone, input.type, input.pickup.lat, input.pickup.lng]
  )

  if (duplicateCheck.rows.length > 0) {
    const existingCode = duplicateCheck.rows[0].case_code
    throw conflict('A similar emergency was reported recently.', { existingCaseId: existingCode })
  }

  const result = await withTransaction(async (client) => {
    const insertRes = await client.query(
      `INSERT INTO emergencies (
         type, severity, reporter_id, reporter_name, reporter_phone,
         description, pickup_lat, pickup_lng, pickup_address,
         status, source, call_session_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'waiting', $10, $11)
       RETURNING *`,
      [
        input.type,
        severity,
        actor.id,
        reporterName,
        normalizedPhone,
        input.description || null,
        input.pickup.lat,
        input.pickup.lng,
        input.pickup.address || null,
        source,
        input.callSessionId || null,
      ]
    )

    const emergencyRow = insertRes.rows[0]

    const historyRes = await client.query(
      `INSERT INTO emergency_status_history (emergency_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, 'waiting', $2, 'Emergency reported')
       RETURNING *`,
      [emergencyRow.id, actor.id]
    )

    return toEmergencyCase(emergencyRow, historyRes.rows)
  })

  // Start dispatch engine asynchronously (non-blocking)
  triggerAsyncDispatch(result.id).catch((err) => {
    logger.error({ err, caseId: result.id }, 'Async dispatch initiation failed')
  })

  return result
}

export async function getEmergencyCase(
  caseCodeOrId: string,
  actor?: ActorInfo,
  client?: PoolClient
): Promise<EmergencyCase> {
  const db = client || pool
  const query = `
    SELECT e.*,
           a.label AS amb_label, a.vehicle_number AS amb_vehicle_number, a.is_test AS amb_is_test,
           a.lat AS amb_lat, a.lng AS amb_lng, a.last_location_at AS amb_last_location_at,
           u.name AS driver_name, u.id AS driver_id,
           h.name AS hosp_name, h.lat AS hosp_lat, h.lng AS hosp_lng, h.address AS hosp_address,
           h.phone AS hosp_phone, h.category AS hosp_category, h.capacity_status AS hosp_capacity_status,
           h.beds AS hosp_beds, h.icu_beds AS hosp_icu_beds, h.last_updated AS hosp_last_updated
    FROM emergencies e
    LEFT JOIN ambulances a ON e.assigned_ambulance_id = a.id
    LEFT JOIN users u ON a.driver_id = u.id
    LEFT JOIN hospitals h ON e.hospital_id = h.id
    WHERE e.case_code = $1 OR e.id::text = $1
  `
  const res = await db.query(query, [caseCodeOrId])
  if (res.rows.length === 0) {
    throw notFound('Emergency case')
  }

  const row = res.rows[0]

  // Authorization check
  if (row.reporter_id) {
    if (!actor) {
      throw forbidden('You do not have permission to view this emergency case.')
    }
    const isAdmin = actor.role === 'admin'
    const isOwner = actor.id && row.reporter_id === actor.id
    const isAssignedDriver = actor.id && row.driver_id === actor.id
    const isAssignedHospital = actor.hospitalId && row.hospital_id === actor.hospitalId

    if (!isAdmin && !isOwner && !isAssignedDriver && !isAssignedHospital) {
      throw forbidden('You do not have permission to view this emergency case.')
    }
  }

  const historyRes = await db.query(
    'SELECT * FROM emergency_status_history WHERE emergency_id = $1 ORDER BY changed_at ASC',
    [row.id]
  )

  return toEmergencyCase(row, historyRes.rows)
}

export async function listEmergencyCases(
  filters: { status?: CaseStatus; type?: EmergencyTypeId; limit?: number; cursor?: string },
  actor: ActorInfo
): Promise<EmergencyCase[]> {
  const conditions: string[] = []
  const values: any[] = []
  let paramIdx = 1

  if (filters.status) {
    conditions.push(`e.status = $${paramIdx++}`)
    values.push(filters.status)
  }

  if (filters.type) {
    conditions.push(`e.type = $${paramIdx++}`)
    values.push(filters.type)
  }

  if (actor.role === 'hospital' && actor.hospitalId) {
    conditions.push(`e.hospital_id = $${paramIdx++}`)
    values.push(actor.hospitalId)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(Math.max(filters.limit || 50, 1), 1000)

  const query = `
    SELECT e.*,
           a.label AS amb_label, a.vehicle_number AS amb_vehicle_number, a.is_test AS amb_is_test,
           a.lat AS amb_lat, a.lng AS amb_lng, a.last_location_at AS amb_last_location_at,
           u.name AS driver_name, u.id AS driver_id,
           h.name AS hosp_name, h.lat AS hosp_lat, h.lng AS hosp_lng, h.address AS hosp_address,
           h.phone AS hosp_phone, h.category AS hosp_category, h.capacity_status AS hosp_capacity_status,
           h.beds AS hosp_beds, h.icu_beds AS hosp_icu_beds, h.last_updated AS hosp_last_updated
    FROM emergencies e
    LEFT JOIN ambulances a ON e.assigned_ambulance_id = a.id
    LEFT JOIN users u ON a.driver_id = u.id
    LEFT JOIN hospitals h ON e.hospital_id = h.id
    ${whereClause}
    ORDER BY e.created_at DESC
    LIMIT ${limit}
  `

  const res = await pool.query(query, values)
  return res.rows.map((row) => toEmergencyCase(row))
}

export async function cancelEmergencyCase(
  caseCodeOrId: string,
  reason: string,
  actor: ActorInfo
): Promise<EmergencyCase> {
  return withTransaction(async (client) => {
    const caseRes = await client.query(
      'SELECT id, case_code, reporter_id, assigned_ambulance_id, status FROM emergencies WHERE case_code = $1 OR id::text = $1 FOR UPDATE',
      [caseCodeOrId]
    )
    if (caseRes.rows.length === 0) {
      throw notFound('Emergency case')
    }

    const row = caseRes.rows[0]

    // Authorization
    if (actor.role !== 'admin' && row.reporter_id !== actor.id) {
      throw forbidden('Only the reporter or an administrator can cancel this case.')
    }

    await changeStatus(client, row.id, 'cancelled', { id: actor.id, role: actor.role }, reason)

    await client.query('UPDATE emergencies SET cancel_reason = $1 WHERE id = $2', [reason, row.id])

    // Free assigned ambulance if any
    if (row.assigned_ambulance_id) {
      await client.query(
        "UPDATE ambulances SET status = 'available', updated_at = now() WHERE id = $1",
        [row.assigned_ambulance_id]
      )
    }

    // Expire any pending dispatch attempt
    await client.query(
      `UPDATE dispatch_attempts
       SET outcome = 'rejected', responded_at = now()
       WHERE emergency_id = $1 AND outcome = 'pending'`,
      [row.id]
    )

    return getEmergencyCase(row.case_code, actor, client)
  })
}

export async function completeEmergencyCase(
  caseCodeOrId: string,
  actor: ActorInfo
): Promise<EmergencyCase> {
  return withTransaction(async (client) => {
    const caseRes = await client.query(
      'SELECT id, case_code, assigned_ambulance_id, status FROM emergencies WHERE case_code = $1 OR id::text = $1 FOR UPDATE',
      [caseCodeOrId]
    )
    if (caseRes.rows.length === 0) {
      throw notFound('Emergency case')
    }

    const row = caseRes.rows[0]
    await changeStatus(client, row.id, 'completed', { id: actor.id, role: actor.role }, 'Completed by admin')

    // Free assigned ambulance
    if (row.assigned_ambulance_id) {
      await client.query(
        "UPDATE ambulances SET status = 'available', updated_at = now() WHERE id = $1",
        [row.assigned_ambulance_id]
      )
    }

    return getEmergencyCase(row.case_code, actor, client)
  })
}

export async function assignEmergencyCase(
  caseCodeOrId: string,
  ambulanceId: string,
  actor: ActorInfo
): Promise<EmergencyCase> {
  return withTransaction(async (client) => {
    const caseRes = await client.query(
      'SELECT id, case_code, status FROM emergencies WHERE case_code = $1 OR id::text = $1 FOR UPDATE',
      [caseCodeOrId]
    )
    if (caseRes.rows.length === 0) {
      throw notFound('Emergency case')
    }

    const ambRes = await client.query(
      'SELECT id, status, label FROM ambulances WHERE id = $1 FOR UPDATE',
      [ambulanceId]
    )
    if (ambRes.rows.length === 0) {
      throw notFound('Ambulance')
    }

    const amb = ambRes.rows[0]
    if (amb.status !== 'available') {
      throw conflict(`Ambulance ${amb.label} is currently ${amb.status} and cannot be assigned.`)
    }

    const emergency = caseRes.rows[0]

    // Cancel any pending attempt for this case
    await client.query(
      `UPDATE dispatch_attempts
       SET outcome = 'rejected', responded_at = now()
       WHERE emergency_id = $1 AND outcome = 'pending'`,
      [emergency.id]
    )

    // Mark ambulance busy
    await client.query("UPDATE ambulances SET status = 'busy', updated_at = now() WHERE id = $1", [
      ambulanceId,
    ])

    // Update emergency
    await client.query(
      'UPDATE emergencies SET assigned_ambulance_id = $1, updated_at = now() WHERE id = $2',
      [ambulanceId, emergency.id]
    )

    await changeStatus(
      client,
      emergency.id,
      'assigned',
      { id: actor.id, role: actor.role },
      `Manually assigned ambulance ${amb.label}`
    )

    return getEmergencyCase(emergency.case_code, actor, client)
  })
}

// Global hook for dispatch integration (implemented in Phase 5)
let dispatchHook: ((caseId: string) => Promise<void>) | null = null

export function registerDispatchHook(fn: (caseId: string) => Promise<void>) {
  dispatchHook = fn
}

async function triggerAsyncDispatch(caseId: string) {
  if (dispatchHook) {
    try {
      await dispatchHook(caseId)
    } catch (err) {
      logger.error({ err, caseId }, 'Dispatch hook failed')
    }
  }
}
