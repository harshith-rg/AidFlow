import type { GraphNode, GraphEdge, PathResult } from '../types'

/**
 * Computes shortest path using Dijkstra's algorithm.
 */
export function runDijkstra(
  startId: string,
  targetId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): PathResult {
  const startTime = performance.now()
  let nodesExpanded = 0

  if (startId === targetId) {
    return {
      path: [startId],
      distanceKm: 0,
      nodesExpanded: 0,
      durationMs: performance.now() - startTime,
    }
  }

  // Adjacency list
  const adj = new Map<string, { to: string; distanceKm: number }[]>()
  for (const n of nodes) {
    adj.set(n.id, [])
  }
  for (const e of edges) {
    adj.get(e.from)?.push({ to: e.to, distanceKm: e.distanceKm })
  }

  const distances = new Map<string, number>()
  const previous = new Map<string, string | null>()
  const unvisited = new Set<string>()

  for (const n of nodes) {
    distances.set(n.id, Infinity)
    previous.set(n.id, null)
    unvisited.add(n.id)
  }
  distances.set(startId, 0)

  while (unvisited.size > 0) {
    // Select node with smallest distance
    let currentId: string | null = null
    let smallestDist = Infinity

    for (const id of unvisited) {
      const d = distances.get(id)!
      if (d < smallestDist) {
        smallestDist = d
        currentId = id
      }
    }

    if (currentId === null || smallestDist === Infinity) {
      break // Unreachable
    }

    nodesExpanded++
    if (currentId === targetId) {
      break // Found target
    }

    unvisited.delete(currentId)

    const neighbors = adj.get(currentId) || []
    for (const neighbor of neighbors) {
      if (!unvisited.has(neighbor.to)) continue
      const alt = smallestDist + neighbor.distanceKm
      if (alt < distances.get(neighbor.to)!) {
        distances.set(neighbor.to, alt)
        previous.set(neighbor.to, currentId)
      }
    }
  }

  const totalDist = distances.get(targetId)
  if (totalDist === undefined || totalDist === Infinity) {
    return {
      path: [],
      distanceKm: Infinity,
      nodesExpanded,
      durationMs: performance.now() - startTime,
    }
  }

  // Reconstruct path
  const path: string[] = []
  let curr: string | null = targetId
  while (curr !== null) {
    path.unshift(curr)
    curr = previous.get(curr) || null
  }

  return {
    path,
    distanceKm: Math.round(totalDist * 100) / 100,
    nodesExpanded,
    durationMs: performance.now() - startTime,
  }
}
