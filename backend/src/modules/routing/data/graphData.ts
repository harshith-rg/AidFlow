import type { GraphNode, GraphEdge } from '../types'
import { calculateGreatCircleKm } from '../providers/haversine'

export const DEMO_GRAPH_NODES: GraphNode[] = [
  { id: 'N1', label: 'MG Road Central (City Center)', lat: 12.9716, lng: 77.5946 },
  { id: 'N2', label: 'Indiranagar 100ft Junction', lat: 12.9784, lng: 77.6408 },
  { id: 'N3', label: 'Koramangala 80ft Junction', lat: 12.9352, lng: 77.6245 },
  { id: 'N4', label: 'Jayanagar 4th Block', lat: 12.925, lng: 77.5857 },
  { id: 'N5', label: 'Hebbal Flyover North', lat: 13.0358, lng: 77.597 },
  { id: 'N6', label: 'JP Nagar 1st Phase (South)', lat: 12.9081, lng: 77.5857 },
  { id: 'N7', label: 'Brigade Road Junction', lat: 12.9725, lng: 77.6 },
  { id: 'N8', label: 'Domlur Intermediate Ring Road', lat: 12.961, lng: 77.638 },
  { id: 'N9', label: 'Dairy Circle Flyover', lat: 12.938, lng: 77.601 },
  { id: 'N10', label: 'Mekhri Circle (North Central)', lat: 13.008, lng: 77.588 },
]

// Bidirectional road connections with explicit weights (km) calculated from coordinates * 1.3
const RAW_EDGES: [string, string][] = [
  ['N1', 'N7'], // MG Road -> Brigade Road
  ['N7', 'N2'], // Brigade Road -> Indiranagar
  ['N7', 'N8'], // Brigade Road -> Domlur
  ['N8', 'N2'], // Domlur -> Indiranagar
  ['N8', 'N3'], // Domlur -> Koramangala
  ['N7', 'N9'], // Brigade Road -> Dairy Circle
  ['N9', 'N3'], // Dairy Circle -> Koramangala
  ['N9', 'N4'], // Dairy Circle -> Jayanagar
  ['N4', 'N6'], // Jayanagar -> JP Nagar
  ['N1', 'N10'], // MG Road -> Mekhri Circle
  ['N10', 'N5'], // Mekhri Circle -> Hebbal
  ['N1', 'N9'], // MG Road -> Dairy Circle
]

export const DEMO_GRAPH_EDGES: GraphEdge[] = []

for (const [fromId, toId] of RAW_EDGES) {
  const nodeA = DEMO_GRAPH_NODES.find((n) => n.id === fromId)!
  const nodeB = DEMO_GRAPH_NODES.find((n) => n.id === toId)!
  const gc = calculateGreatCircleKm(nodeA, nodeB)
  const dist = Math.round(gc * 1.3 * 100) / 100

  // Bidirectional edges
  DEMO_GRAPH_EDGES.push({ from: fromId, to: toId, distanceKm: dist })
  DEMO_GRAPH_EDGES.push({ from: toId, to: fromId, distanceKm: dist })
}
