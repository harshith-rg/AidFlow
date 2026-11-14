import type { RouteResult, RoutingProvider } from '../types'
import { env } from '../../../config/env'

interface PythonRouteResponse {
  status: string
  distance_km: number
  duration_min: number
  polyline: unknown
  source: string
  assumptions: string[]
}

export class PythonProvider implements RoutingProvider {
  readonly name = 'python'

  async route(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<RouteResult> {
    const baseUrl = env.PYTHON_ROUTING_URL.replace(/\/$/, '')

    if (!baseUrl) {
      throw new Error('PYTHON_ROUTING_URL is not configured')
    }

    const response = await fetch(`${baseUrl}/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin_lat: from.lat,
        origin_lng: from.lng,
        destination_lat: to.lat,
        destination_lng: to.lng,
      }),
    })

    if (!response.ok) {
      throw new Error(`Python routing service failed with status ${response.status}`)
    }

    const data = (await response.json()) as PythonRouteResponse

    return {
      distanceKm: data.distance_km,
      durationMin: data.duration_min,
      geometry: data.polyline,
      source: data.source,
      assumptions: data.assumptions,
    }
  }
}
