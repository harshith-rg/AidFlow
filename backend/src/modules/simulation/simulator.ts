import { pool } from '../../db/pool'
import { env } from '../../config/env'
import { forbidden, notFound, badRequest } from '../../utils/errors'
import { updateLocation } from '../ambulances/ambulances.service'
import { logger } from '../../utils/logger'
import type { LatLng } from '../routing/types'

interface ActiveSimulation {
  ambulanceId: string
  caseId: string
  timer: NodeJS.Timeout
  waypoints: LatLng[]
  currentIndex: number
}

const activeSimulations = new Map<string, ActiveSimulation>()

export function checkSimulationEnabled() {
  if (!env.SIMULATION_ENABLED) {
    throw forbidden('Simulation module is disabled in production.')
  }
}

/**
 * Starts moving an ambulance along the case's route polyline (or fallback straight line),
 * emitting monotonic updates through the standard location service.
 */
export async function startFollowCase(
  ambulanceId: string,
  caseCodeOrId: string,
  intervalMs = 1000
): Promise<{ started: boolean; totalWaypoints: number; caseId: string }> {
  checkSimulationEnabled()

  // Stop any existing simulation on this ambulance
  stopSimulation(ambulanceId)

  // Query case
  const caseRes = await pool.query(
    `SELECT id, case_code, pickup_lat, pickup_lng, route_polyline
     FROM emergencies
     WHERE case_code = $1 OR id::text = $1`,
    [caseCodeOrId]
  )

  if (caseRes.rows.length === 0) {
    throw notFound('Emergency case')
  }

  const emg = caseRes.rows[0]
  const pickup: LatLng = { lat: Number(emg.pickup_lat), lng: Number(emg.pickup_lng) }

  // Query ambulance current location
  const ambRes = await pool.query('SELECT id, lat, lng FROM ambulances WHERE id = $1', [ambulanceId])
  if (ambRes.rows.length === 0) {
    throw notFound('Ambulance')
  }
  const amb = ambRes.rows[0]
  const startLoc: LatLng = {
    lat: amb.lat ? Number(amb.lat) : 12.9716,
    lng: amb.lng ? Number(amb.lng) : 77.5946,
  }

  let waypoints: LatLng[] = []
  if (emg.route_polyline && Array.isArray(emg.route_polyline) && emg.route_polyline.length >= 2) {
    waypoints = emg.route_polyline
  } else {
    // Generate straight-line interpolated path (10 segments)
    const steps = 10
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps
      waypoints.push({
        lat: startLoc.lat + (pickup.lat - startLoc.lat) * frac,
        lng: startLoc.lng + (pickup.lng - startLoc.lng) * frac,
      })
    }
  }

  let currentIndex = 0
  let seq = 1000

  const timer = setInterval(async () => {
    if (currentIndex >= waypoints.length) {
      stopSimulation(ambulanceId)
      return
    }

    const currentPoint = waypoints[currentIndex]
    const nextPoint = waypoints[currentIndex + 1] || currentPoint

    // Calculate heading in degrees
    const dLng = nextPoint.lng - currentPoint.lng
    const dLat = nextPoint.lat - currentPoint.lat
    const heading = Math.round((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360

    seq++
    try {
      await updateLocation({
        ambulanceId,
        lat: currentPoint.lat,
        lng: currentPoint.lng,
        timestamp: new Date(),
        heading,
        speed: 40,
        seq,
        simulated: true,
      })
    } catch (err) {
      logger.error({ err, ambulanceId }, 'Simulation location update failed')
    }

    currentIndex++
  }, intervalMs)

  timer.unref()

  activeSimulations.set(ambulanceId, {
    ambulanceId,
    caseId: emg.case_code,
    timer,
    waypoints,
    currentIndex: 0,
  })

  return {
    started: true,
    totalWaypoints: waypoints.length,
    caseId: emg.case_code,
  }
}

export function stopSimulation(ambulanceId?: string): { stopped: number } {
  if (ambulanceId) {
    const sim = activeSimulations.get(ambulanceId)
    if (sim) {
      clearInterval(sim.timer)
      activeSimulations.delete(ambulanceId)
      return { stopped: 1 }
    }
    return { stopped: 0 }
  }

  let count = 0
  for (const [id, sim] of activeSimulations.entries()) {
    clearInterval(sim.timer)
    activeSimulations.delete(id)
    count++
  }
  return { stopped: count }
}
