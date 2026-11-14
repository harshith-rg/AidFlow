import { pool, withTransaction } from '../../db/pool'
import { env } from '../../config/env'
import { conflict, forbidden, notFound, badRequest } from '../../utils/errors'
import { emitToRoom } from '../../realtime/events'
import type { Ambulance } from '../../types/contract'

export interface LocationUpdateInput {
  ambulanceId: string
  lat: number
  lng: number
  timestamp?: string | number | Date
  heading?: number | null
  speed?: number | null
  seq?: number
  simulated?: boolean
}

export interface LocationUpdateResult {
  applied: boolean
  reason?: string
  ambulanceId: string
  lat?: number
  lng?: number
  timestamp?: string
}

export async function updateAvailability(
  ambulanceId: string,
  targetStatus: 'available' | 'offline',
  actor: { id: string; role: string }
): Promise<Ambulance> {
  return withTransaction(async (client) => {
    const ambRes = await client.query('SELECT * FROM ambulances WHERE id = $1 FOR UPDATE', [ambulanceId])
    if (ambRes.rows.length === 0) {
      throw notFound('Ambulance')
    }

    const amb = ambRes.rows[0]

    // Ownership check
    if (actor.role !== 'admin' && amb.driver_id !== actor.id) {
      throw forbidden('You are not authorized to update this ambulance availability.')
    }

    // Cannot set offline while holding an active case
    if (targetStatus === 'offline') {
      const activeRes = await client.query(
        `SELECT id, case_code FROM emergencies
         WHERE assigned_ambulance_id = $1
           AND status IN ('assigned', 'en_route', 'reached_patient', 'heading_to_hospital')`,
        [ambulanceId]
      )
      if (activeRes.rows.length > 0) {
        throw conflict(
          `Cannot go offline while holding active emergency case ${activeRes.rows[0].case_code}.`
        )
      }
    }

    const updateRes = await client.query(
      `UPDATE ambulances SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [targetStatus, ambulanceId]
    )

    const updated = updateRes.rows[0]
    return {
      id: updated.id,
      label: updated.label,
      vehicleNumber: updated.vehicle_number,
      status: updated.status,
      lat: updated.lat,
      lng: updated.lng,
      lastLocationAt: updated.last_location_at ? new Date(updated.last_location_at).toISOString() : undefined,
    }
  })
}

export async function updateLocation(input: LocationUpdateInput): Promise<LocationUpdateResult> {
  const { ambulanceId, lat, lng } = input

  if (typeof lat !== 'number' || typeof lng !== 'number' || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw badRequest('Invalid coordinates for ambulance location.')
  }

  const updateTime = input.timestamp ? new Date(input.timestamp) : new Date()
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)
  if (updateTime > fiveMinFromNow) {
    throw badRequest('Location timestamp cannot be in the future.')
  }

  let activeCaseCode: string | null = null

  const result = await withTransaction(async (client) => {
    const ambRes = await client.query(
      'SELECT id, last_location_at, last_location_seq FROM ambulances WHERE id = $1 FOR UPDATE',
      [ambulanceId]
    )

    if (ambRes.rows.length === 0) {
      throw notFound('Ambulance')
    }

    const current = ambRes.rows[0]

    // Stale location checks: monotonic timestamps and sequences
    if (current.last_location_at) {
      const currentAt = new Date(current.last_location_at)
      if (updateTime <= currentAt) {
        return { applied: false, reason: 'stale', ambulanceId }
      }
    }

    if (input.seq !== undefined && current.last_location_seq) {
      if (input.seq <= Number(current.last_location_seq)) {
        return { applied: false, reason: 'out_of_order_sequence', ambulanceId }
      }
    }

    const nextSeq = input.seq ?? (Number(current.last_location_seq || 0) + 1)

    await client.query(
      `UPDATE ambulances
       SET lat = $1, lng = $2, last_location_at = $3, last_location_seq = $4,
           heading = $5, speed_kmh = $6, updated_at = now()
       WHERE id = $7`,
      [lat, lng, updateTime, nextSeq, input.heading ?? null, input.speed ?? null, ambulanceId]
    )

    // Lookup active case to notify tracking subscribers
    const activeCaseRes = await client.query(
      `SELECT case_code FROM emergencies
       WHERE assigned_ambulance_id = $1
         AND status IN ('assigned', 'en_route', 'reached_patient', 'heading_to_hospital')
       LIMIT 1`,
      [ambulanceId]
    )
    if (activeCaseRes.rows.length > 0) {
      activeCaseCode = activeCaseRes.rows[0].case_code
    }

    return {
      applied: true,
      ambulanceId,
      lat,
      lng,
      timestamp: updateTime.toISOString(),
    }
  })

  // POST-COMMIT EMIT
  if (result.applied) {
    const locationPayload = {
      ambulanceId,
      lat,
      lng,
      heading: input.heading ?? null,
      speedKmh: input.speed ?? null,
      timestamp: updateTime.toISOString(),
      isStale: false,
      simulated: Boolean(input.simulated),
    }

    emitToRoom('role:admin', 'ambulance:location', locationPayload)
    if (activeCaseCode) {
      emitToRoom(`case:${activeCaseCode}`, 'ambulance:location', locationPayload)
    }
  }

  return result
}

export async function listAmbulances(): Promise<(Ambulance & { isStale: boolean; driverName?: string })[]> {
  const staleSeconds = env.LOCATION_STALE_SECONDS || 120
  const staleCutoff = new Date(Date.now() - staleSeconds * 1000)

  const res = await pool.query(
    `SELECT a.*, u.name as driver_name
     FROM ambulances a
     LEFT JOIN users u ON a.driver_id = u.id
     ORDER BY a.label ASC`
  )

  return res.rows.map((row) => {
    const locTime = row.last_location_at ? new Date(row.last_location_at) : null
    const isStale = !locTime || locTime < staleCutoff

    return {
      id: row.id,
      label: row.label,
      vehicleNumber: row.vehicle_number,
      status: row.status,
      lat: row.lat,
      lng: row.lng,
      lastLocationAt: locTime ? locTime.toISOString() : undefined,
      isStale,
      driverName: row.driver_name || undefined,
    }
  })
}
