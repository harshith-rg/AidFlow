import type { RouteResult, RoutingProvider, LatLng } from '../types'
import { env } from '../../../config/env'

interface PythonRouteResponse {
  status: string
  distance_km: number
  duration_min: number
  polyline: [number, number][]
  source: string
  assumptions: {
    average_speed_kmh: number
    live_traffic: boolean
    routing_algorithm: string
    demo_road_network: boolean
  }
}

export class PythonProvider implements RoutingProvider {
  readonly name = 'python'

  async route(
    from: LatLng,
    to: LatLng,
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
      throw new Error(
        `Python routing service failed with status ${response.status}`,
      )
    }

    const data = (await response.json()) as PythonRouteResponse

    if (data.status !== 'ok') {
      throw new Error('Python routing service returned an invalid response')
    }

    const geometry: LatLng[] = data.polyline.map(([lat, lng]) => ({
      lat,
      lng,
    }))

    return {
      distanceKm: data.distance_km,
      durationMin: data.duration_min,
      geometry,
      source: 'python',
      assumptions: `A* routing; average speed ${data.assumptions.average_speed_kmh} km/h; live traffic unavailable; demo road network`,
    }
  }
}
