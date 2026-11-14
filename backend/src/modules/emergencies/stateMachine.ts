import type { PoolClient } from 'pg'
import type { CaseStatus, Role } from '../../types/contract'
import { conflict, forbidden } from '../../utils/errors'

export interface AllowedTransition {
  from: CaseStatus
  to: CaseStatus
  allowedRoles: Role[]
}

export const ALLOWED_TRANSITIONS: AllowedTransition[] = [
  // Creation -> waiting
  // Waiting -> offered (by system during dispatch engine run)
  { from: 'waiting', to: 'offered', allowedRoles: ['admin'] },
  // Offered -> assigned (when driver accepts)
  { from: 'offered', to: 'assigned', allowedRoles: ['driver', 'admin'] },
  // Offered -> waiting (when rejected or timed out and returning to pool)
  { from: 'offered', to: 'waiting', allowedRoles: ['driver', 'admin'] },
  // Waiting -> assigned (manual assign by admin)
  { from: 'waiting', to: 'assigned', allowedRoles: ['admin'] },
  // Driver journey progression
  { from: 'assigned', to: 'en_route', allowedRoles: ['driver', 'admin'] },
  { from: 'en_route', to: 'reached_patient', allowedRoles: ['driver', 'admin'] },
  { from: 'reached_patient', to: 'heading_to_hospital', allowedRoles: ['driver', 'admin'] },
  { from: 'heading_to_hospital', to: 'handed_over', allowedRoles: ['driver', 'admin'] },
  // Handed over -> completed (by admin or hospital)
  { from: 'handed_over', to: 'completed', allowedRoles: ['admin', 'hospital'] },
  // Direct complete allowed by admin
  { from: 'assigned', to: 'completed', allowedRoles: ['admin'] },
  { from: 'en_route', to: 'completed', allowedRoles: ['admin'] },
  { from: 'reached_patient', to: 'completed', allowedRoles: ['admin'] },
  { from: 'heading_to_hospital', to: 'completed', allowedRoles: ['admin'] },
  // Cancellation from any non-terminal state
  { from: 'waiting', to: 'cancelled', allowedRoles: ['patient', 'admin'] },
  { from: 'offered', to: 'cancelled', allowedRoles: ['patient', 'admin'] },
  { from: 'assigned', to: 'cancelled', allowedRoles: ['patient', 'admin'] },
  { from: 'en_route', to: 'cancelled', allowedRoles: ['patient', 'admin'] },
  { from: 'reached_patient', to: 'cancelled', allowedRoles: ['patient', 'admin'] },
  { from: 'heading_to_hospital', to: 'cancelled', allowedRoles: ['patient', 'admin'] },
  { from: 'handed_over', to: 'cancelled', allowedRoles: ['patient', 'admin'] },
]

export function isTransitionAllowed(from: CaseStatus, to: CaseStatus, role: Role): boolean {
  return ALLOWED_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.allowedRoles.includes(role)
  )
}

/**
 * Executes an atomic status transition on an emergency case.
 * Enforces valid transition from current status and records in emergency_status_history.
 */
export async function changeStatus(
  client: PoolClient,
  caseId: string,
  toStatus: CaseStatus,
  actor: { id: string | null; role: Role },
  note?: string
): Promise<{ previousStatus: CaseStatus; newStatus: CaseStatus }> {
  // Lock the emergency record FOR UPDATE
  const res = await client.query(
    'SELECT id, status FROM emergencies WHERE id = $1 FOR UPDATE',
    [caseId]
  )

  if (res.rows.length === 0) {
    throw conflict(`Emergency case ${caseId} not found.`)
  }

  const currentStatus = res.rows[0].status as CaseStatus
  if (currentStatus === toStatus) {
    return { previousStatus: currentStatus, newStatus: toStatus }
  }

  // Check if target is a terminal transition from terminal state
  if (currentStatus === 'completed' || currentStatus === 'cancelled') {
    throw conflict(`Cannot transition case ${caseId} from terminal state '${currentStatus}'.`)
  }

  // Check validity
  const allowed = isTransitionAllowed(currentStatus, toStatus, actor.role)
  if (!allowed) {
    throw conflict(
      `Illegal transition from '${currentStatus}' to '${toStatus}' for role '${actor.role}'.`
    )
  }

  // Update status
  await client.query(
    'UPDATE emergencies SET status = $1, updated_at = now() WHERE id = $2',
    [toStatus, caseId]
  )

  // Record history
  await client.query(
    `INSERT INTO emergency_status_history (emergency_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [caseId, currentStatus, toStatus, actor.id, note || null]
  )

  return { previousStatus: currentStatus, newStatus: toStatus }
}
