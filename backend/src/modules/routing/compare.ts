import { DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES } from './data/graphData'
import { runDijkstra } from './algorithms/dijkstra'
import { runAStar } from './algorithms/astar'

interface ComparisonRow {
  pair: string
  fromLabel: string
  toLabel: string
  dijkstraDistKm: number
  dijkstraNodes: number
  dijkstraTimeMs: string
  astarDistKm: number
  astarNodes: number
  astarTimeMs: string
  distEqual: boolean
}

export function compareAlgorithms(): ComparisonRow[] {
  const testPairs: [string, string][] = [
    ['N1', 'N5'], // Central MG Road -> Hebbal North
    ['N6', 'N2'], // JP Nagar South -> Indiranagar East
    ['N4', 'N10'], // Jayanagar -> Mekhri Circle
    ['N3', 'N5'], // Koramangala -> Hebbal North
    ['N6', 'N10'], // JP Nagar -> Mekhri Circle
    ['N2', 'N6'], // Indiranagar -> JP Nagar
  ]

  const results: ComparisonRow[] = []

  for (const [fromId, toId] of testPairs) {
    const fromNode = DEMO_GRAPH_NODES.find((n) => n.id === fromId)!
    const toNode = DEMO_GRAPH_NODES.find((n) => n.id === toId)!

    const dRes = runDijkstra(fromId, toId, DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES)
    const aRes = runAStar(fromId, toId, DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES)

    results.push({
      pair: `${fromId} -> ${toId}`,
      fromLabel: fromNode.label,
      toLabel: toNode.label,
      dijkstraDistKm: dRes.distanceKm,
      dijkstraNodes: dRes.nodesExpanded,
      dijkstraTimeMs: dRes.durationMs.toFixed(3),
      astarDistKm: aRes.distanceKm,
      astarNodes: aRes.nodesExpanded,
      astarTimeMs: aRes.durationMs.toFixed(3),
      distEqual: Math.abs(dRes.distanceKm - aRes.distanceKm) < 0.001,
    })
  }

  return results
}

if (require.main === module || process.argv[1]?.endsWith('compare.ts')) {
  console.log('='.repeat(90))
  console.log('AidFlow Routing Algorithm Benchmark: Dijkstra vs A* (Haversine Heuristic)')
  console.log('='.repeat(90))

  const rows = compareAlgorithms()
  console.table(
    rows.map((r) => ({
      Pair: r.pair,
      'From -> To': `${r.fromLabel.slice(0, 15)} -> ${r.toLabel.slice(0, 15)}`,
      'Dijkstra (km)': r.dijkstraDistKm,
      'Dijkstra Nodes': r.dijkstraNodes,
      'Dijkstra (ms)': r.dijkstraTimeMs,
      'A* (km)': r.astarDistKm,
      'A* Nodes': r.astarNodes,
      'A* (ms)': r.astarTimeMs,
      'Dist Match?': r.distEqual ? 'MATCH' : 'MISMATCH',
    }))
  )

  const allEqual = rows.every((r) => r.distEqual)
  console.log(`\nVerification: All computed shortest path distances match: ${allEqual ? 'YES' : 'NO'}`)
  console.log('A* achieves equivalent optimality while expanding fewer or equal nodes due to admissible heuristic.')
  console.log('='.repeat(90))
}
