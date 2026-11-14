import type { LatLng } from '../../types/contract'

export type { LatLng }

export type RoutingProviderType = 'haversine' | 'graph' | 'osrm' | 'ors'

export interface RouteResult {
  distanceKm: number
  durationMin: number
  geometry: LatLng[]
  source: RoutingProviderType
  assumptions: string
}

export interface RoutingProvider {
  name: RoutingProviderType
  route(from: LatLng, to: LatLng): Promise<RouteResult>
}

export interface GraphNode {
  id: string
  label: string
  lat: number
  lng: number
}

export interface GraphEdge {
  from: string
  to: string
  distanceKm: number
}

export interface PathResult {
  path: string[]
  distanceKm: number
  nodesExpanded: number
  durationMs: number
}
