import { env } from '../../../config/env'
import type { LatLng, RouteResult, RoutingProvider } from '../types'

/**
 * Calculates Great-Circle distance in kilometers between two coordinates using the Haversine formula.
 */
export function calculateGreatCircleKm(from: LatLng, to: LatLng): number {
  const R = 6371 // Earth's mean radius in km
  const dLat = ((to.lat - from.lat) * Math.PI) / 180
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export class HaversineProvider implements RoutingProvider {
  name = 'haversine' as const

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const gcDist = calculateGreatCircleKm(from, to)
    // Road winding factor 1.3 accounts for urban street grid
    const roadFactor = 1.3
    const distanceKm = Math.round(gcDist * roadFactor * 100) / 100
    const speedKmh = env.ROUTING_SPEED_KMH || 35
    const durationMin = Math.max(1, Math.round((distanceKm / speedKmh) * 60))

    return {
      distanceKm,
      durationMin,
      geometry: [from, to],
      source: 'haversine',
      assumptions: `Estimate, not road-accurate. Calculated via Haversine great-circle distance with a 1.3 road-winding factor at an assumed speed of ${speedKmh} km/h. Does not account for live traffic.`,
    }
  }
}
