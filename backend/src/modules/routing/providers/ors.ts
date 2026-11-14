import { env } from '../../../config/env'
import { HaversineProvider } from './haversine'
import type { LatLng, RouteResult, RoutingProvider } from '../types'

export class OrsProvider implements RoutingProvider {
  name = 'ors' as const
  private fallback = new HaversineProvider()

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    if (!env.ORS_API_KEY) {
      const fb = await this.fallback.route(from, to)
      fb.assumptions = `ORS_API_KEY not configured. Fallback to Haversine: ${fb.assumptions}`
      return fb
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    try {
      const url = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson'
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: env.ORS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        throw new Error(`ORS HTTP error: ${res.statusText}`)
      }

      const data = await res.json()
      const feature = data.features?.[0]
      if (!feature) {
        throw new Error('No ORS route found')
      }

      const summary = feature.properties?.summary
      const distanceKm = Math.round(((summary?.distance || 0) / 1000) * 100) / 100
      const durationMin = Math.max(1, Math.round((summary?.duration || 0) / 60))
      const coordinates: [number, number][] = feature.geometry?.coordinates || []
      const geometry: LatLng[] = coordinates.map(([lng, lat]) => ({ lat, lng }))

      return {
        distanceKm,
        durationMin,
        geometry: geometry.length > 0 ? geometry : [from, to],
        source: 'ors',
        assumptions: 'OpenRouteService road network route calculation without live traffic conditions.',
      }
    } catch (_err) {
      clearTimeout(timeout)
      const fb = await this.fallback.route(from, to)
      fb.assumptions = `ORS request failed/timed out. Fallback to Haversine: ${fb.assumptions}`
      return fb
    }
  }
}
