import type { RouteResult, RoutingProvider, LatLng } from '../types'
import { env } from '../../../config/env'
import { logger } from '../../../utils/logger'
import { HaversineProvider } from './haversine'

// Maximum time to wait for the Python routing service before falling back.
const PYTHON_ROUTING_TIMEOUT_MS = 5000

interface PythonRouteResponse {
  status: string
  distance_km: number
  duration_min: number
  polyline: [number, number][]
  source?: string
  assumptions?: {
    average_speed_kmh?: number
    live_traffic?: boolean
    routing_algorithm?: string
    demo_road_network?: boolean
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidResponse(data: unknown): data is PythonRouteResponse {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    d.status === 'ok' &&
    isFiniteNumber(d.distance_km) &&
    isFiniteNumber(d.duration_min) &&
    Array.isArray(d.polyline) &&
    d.polyline.every(
      (p) => Array.isArray(p) && p.length === 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]),
    )
  )
}

/**
 * Routes through the Python FastAPI A* service (POST {PYTHON_ROUTING_URL}/route).
 *
 * If the service is not configured, is unreachable, is too slow, rejects the request
 * (for example a point outside the road-graph coverage) or returns an unexpected body,
 * this provider returns a straight-line haversine estimate instead of throwing, so one
 * bad route never breaks hospital recommendation or ambulance dispatch. The fallback is
 * labelled: its `source` is 'haversine' and `assumptions` names the reason.
 */
export class PythonProvider implements RoutingProvider {
  readonly name = 'python'

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const baseUrl = (env.PYTHON_ROUTING_URL || '').replace(/\/+$/, '')
    if (!baseUrl) {
      return this.fallback(from, to, 'PYTHON_ROUTING_URL is not configured')
    }

    let response: Response
    try {
      response = await fetch(`${baseUrl}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_lat: from.lat,
          origin_lng: from.lng,
          destination_lat: to.lat,
          destination_lng: to.lng,
        }),
        signal: AbortSignal.timeout(PYTHON_ROUTING_TIMEOUT_MS),
      })
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      return this.fallback(from, to, timedOut ? 'request timed out' : 'service unreachable')
    }

    if (!response.ok) {
      return this.fallback(from, to, `service returned HTTP ${response.status}`)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      return this.fallback(from, to, 'service returned invalid JSON')
    }

    if (!isValidResponse(data)) {
      return this.fallback(from, to, 'service returned an unexpected response')
    }

    const speed = data.assumptions?.average_speed_kmh
    return {
      distanceKm: data.distance_km,
      durationMin: data.duration_min,
      geometry: data.polyline.map(([lat, lng]) => ({ lat, lng })),
      source: 'python',
      assumptions: `A* routing on the Bengaluru demo road graph${
        isFiniteNumber(speed) ? `; average speed ${speed} km/h` : ''
      }; live traffic unavailable; demo road network`,
    }
  }

  private async fallback(from: LatLng, to: LatLng, reason: string): Promise<RouteResult> {
    logger.warn({ reason }, 'Python routing unavailable; using haversine estimate')
    const estimate = await new HaversineProvider().route(from, to)
    return {
      ...estimate,
      assumptions: `Python A* routing unavailable (${reason}); ${estimate.assumptions}`,
    }
  }
}
