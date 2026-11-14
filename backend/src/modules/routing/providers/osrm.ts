import { env } from '../../../config/env'
import { HaversineProvider } from './haversine'
import type { LatLng, RouteResult, RoutingProvider } from '../types'

export class OsrmProvider implements RoutingProvider {
  name = 'osrm' as const
  private fallback = new HaversineProvider()

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    if (!env.OSRM_URL) {
      const fb = await this.fallback.route(from, to)
      fb.assumptions = `OSRM_URL not configured. Fallback to Haversine: ${fb.assumptions}`
      return fb
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    try {
      const url = `${env.OSRM_URL.replace(/\/$/, '')}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=geojson`
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeout)

      if (!res.ok) {
        throw new Error(`OSRM HTTP error: ${res.statusText}`)
      }

      const data = await res.json()
      if (!data.routes || data.routes.length === 0) {
        throw new Error('No OSRM route found')
      }

      const route = data.routes[0]
      const distanceKm = Math.round((route.distance / 1000) * 100) / 100
      const durationMin = Math.max(1, Math.round(route.duration / 60))
      const coordinates: [number, number][] = route.geometry?.coordinates || []
      const geometry: LatLng[] = coordinates.map(([lng, lat]) => ({ lat, lng }))

      return {
        distanceKm,
        durationMin,
        geometry: geometry.length > 0 ? geometry : [from, to],
        source: 'osrm',
        assumptions: 'OSRM road network route calculation without live traffic conditions.',
      }
    } catch (_err) {
      clearTimeout(timeout)
      const fb = await this.fallback.route(from, to)
      fb.assumptions = `OSRM request failed/timed out. Fallback to Haversine: ${fb.assumptions}`
      return fb
    }
  }
}
