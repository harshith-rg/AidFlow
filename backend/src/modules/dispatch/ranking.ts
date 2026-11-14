import type { PoolClient } from 'pg'
import { pool } from '../../db/pool'
import { env } from '../../config/env'
import { getRoutingProvider } from '../routing/router'
import { calculateGreatCircleKm } from '../routing/providers/haversine'
import type { LatLng } from '../routing/types'

export interface CandidateAmbulance {
  id: string
  label: string
  vehicle_number: string
  driver_id: string | null
  status: string
  lat: number
  lng: number
  last_location_at: Date
  is_test: boolean
  distanceKm?: number
  etaMinutes?: number
}

/**
 * Finds eligible ambulances and ranks them by estimated road travel time to the emergency pickup location.
 *
 * Eligibility Criteria:
 * 1. Status is 'available'
 * 2. Has valid spatial coordinates
 * 3. Telemetry updated within LOCATION_STALE_SECONDS (default 120s)
 * 4. Within DISPATCH_RADIUS_KM (default 50 km)
 * 5. Not already attempted for this emergency case (or resets on retry rounds)
 *
 * Ranking Criteria:
 * 1. Shortest estimated road ETA (minutes) via RoutingProvider
 * 2. Tie-break: lower distance (km)
 * 3. Tie-break: alphabetical ambulance label
 */
export async function rankCandidateAmbulances(
  client: PoolClient | null,
  emergencyId: string,
  pickup: LatLng,
  allowPreviousAttempts = false
): Promise<CandidateAmbulance[]> {
  const db = client || pool
  const staleSeconds = env.LOCATION_STALE_SECONDS || 120
  const maxRadiusKm = env.DISPATCH_RADIUS_KM || 50

  const query = `
    SELECT a.id, a.label, a.vehicle_number, a.driver_id, a.status,
           a.lat, a.lng, a.last_location_at, a.is_test
    FROM ambulances a
    WHERE a.status = 'available'
      AND a.lat IS NOT NULL
      AND a.lng IS NOT NULL
      AND a.last_location_at >= now() - ($1 || ' seconds')::interval
      AND ($2::boolean = TRUE OR a.id NOT IN (
        SELECT ambulance_id FROM dispatch_attempts WHERE emergency_id = $3
      ))
  `

  const res = await db.query(query, [staleSeconds, allowPreviousAttempts, emergencyId])
  const candidates: CandidateAmbulance[] = res.rows.map((r) => ({
    ...r,
    lat: Number(r.lat),
    lng: Number(r.lng),
  }))

  if (candidates.length === 0) {
    return []
  }

  // Filter by spatial radius and score with routing provider
  const routing = getRoutingProvider()
  const scored: CandidateAmbulance[] = []

  for (const amb of candidates) {
    const gcDist = calculateGreatCircleKm({ lat: amb.lat, lng: amb.lng }, pickup)
    if (gcDist > maxRadiusKm) {
      continue
    }

    const route = await routing.route({ lat: amb.lat, lng: amb.lng }, pickup)
    amb.distanceKm = route.distanceKm
    amb.etaMinutes = route.durationMin
    scored.push(amb)
  }

  // Sort by ETA, then distance, then label
  scored.sort((a, b) => {
    if ((a.etaMinutes ?? Infinity) !== (b.etaMinutes ?? Infinity)) {
      return (a.etaMinutes ?? Infinity) - (b.etaMinutes ?? Infinity)
    }
    if ((a.distanceKm ?? Infinity) !== (b.distanceKm ?? Infinity)) {
      return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
    }
    return a.label.localeCompare(b.label)
  })

  return scored
}
