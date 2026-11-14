import { env } from '../../../config/env'
import { DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES } from '../data/graphData'
import { runDijkstra } from '../algorithms/dijkstra'
import { calculateGreatCircleKm, HaversineProvider } from './haversine'
import type { LatLng, RouteResult, RoutingProvider, GraphNode } from '../types'

function findNearestNode(coord: LatLng, nodes: GraphNode[]): GraphNode {
  let nearest = nodes[0]
  let minDist = Infinity
  for (const n of nodes) {
    const d = calculateGreatCircleKm(coord, n)
    if (d < minDist) {
      minDist = d
      nearest = n
    }
  }
  return nearest
}

export class GraphProvider implements RoutingProvider {
  name = 'graph' as const

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const startNode = findNearestNode(from, DEMO_GRAPH_NODES)
    const endNode = findNearestNode(to, DEMO_GRAPH_NODES)

    // Do not snap locations far outside the Bengaluru demo graph onto unrelated roads.
    const snapStartKm = calculateGreatCircleKm(from, startNode)
    const snapEndKm = calculateGreatCircleKm(to, endNode)
    if (snapStartKm > 8 || snapEndKm > 8) {
      const fallback = await new HaversineProvider().route(from, to)
      fallback.assumptions = 'Outside the coverage of the Bengaluru demo road graph; using a straight-line estimate instead of inventing a road route.'
      return fallback
    }

    // Snap distance
    const distToStart = snapStartKm * 1.3
    const distFromEnd = snapEndKm * 1.3

    const pathRes = runDijkstra(startNode.id, endNode.id, DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES)
    const totalDistanceKm =
      Math.round((distToStart + (pathRes.distanceKm === Infinity ? 0 : pathRes.distanceKm) + distFromEnd) * 100) / 100

    const speedKmh = env.ROUTING_SPEED_KMH || 35
    const durationMin = Math.max(1, Math.round((totalDistanceKm / speedKmh) * 60))

    // Construct polyline geometry
    const geometry: LatLng[] = [{ lat: from.lat, lng: from.lng }]
    for (const nodeId of pathRes.path) {
      const node = DEMO_GRAPH_NODES.find((n) => n.id === nodeId)!
      geometry.push({ lat: node.lat, lng: node.lng })
    }
    geometry.push({ lat: to.lat, lng: to.lng })

    return {
      distanceKm: totalDistanceKm,
      durationMin,
      geometry,
      source: 'graph',
      assumptions: `Calculated using custom road network graph using Dijkstra's shortest-path algorithm snapped to nearest junctions (${startNode.label} -> ${endNode.label}) at assumed speed of ${speedKmh} km/h. Does not account for live traffic.`,
    }
  }
}
