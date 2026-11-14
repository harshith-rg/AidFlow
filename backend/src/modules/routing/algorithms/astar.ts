import type { GraphNode, GraphEdge, PathResult } from '../types'
import { calculateGreatCircleKm } from '../providers/haversine'

/**
 * Computes shortest path using A* search with Haversine distance heuristic.
 */
export function runAStar(
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

  const nodeMap = new Map<string, GraphNode>()
  for (const n of nodes) {
    nodeMap.set(n.id, n)
  }

  const targetNode = nodeMap.get(targetId)!

  // Adjacency list
  const adj = new Map<string, { to: string; distanceKm: number }[]>()
  for (const n of nodes) {
    adj.set(n.id, [])
  }
  for (const e of edges) {
    adj.get(e.from)?.push({ to: e.to, distanceKm: e.distanceKm })
  }

  // Heuristic: great-circle straight-line distance is admissible (never overestimates)
  function heuristic(nodeId: string): number {
    const n = nodeMap.get(nodeId)!
    return calculateGreatCircleKm(n, targetNode)
  }

  const openSet = new Set<string>([startId])
  const closedSet = new Set<string>()

  const gScore = new Map<string, number>()
  const fScore = new Map<string, number>()
  const cameFrom = new Map<string, string>()

  for (const n of nodes) {
    gScore.set(n.id, Infinity)
    fScore.set(n.id, Infinity)
  }
  gScore.set(startId, 0)
  fScore.set(startId, heuristic(startId))

  while (openSet.size > 0) {
    // Pick node in openSet with lowest fScore
    let currentId: string | null = null
    let lowestF = Infinity
    for (const id of openSet) {
      const f = fScore.get(id)!
      if (f < lowestF) {
        lowestF = f
        currentId = id
      }
    }

    if (currentId === null || lowestF === Infinity) {
      break
    }

    nodesExpanded++

    if (currentId === targetId) {
      // Reconstruct path
      const path = [currentId]
      let curr = currentId
      while (cameFrom.has(curr)) {
        curr = cameFrom.get(curr)!
        path.unshift(curr)
      }

      return {
        path,
        distanceKm: Math.round(gScore.get(targetId)! * 100) / 100,
        nodesExpanded,
        durationMs: performance.now() - startTime,
      }
    }

    openSet.delete(currentId)
    closedSet.add(currentId)

    const neighbors = adj.get(currentId) || []
    for (const neighbor of neighbors) {
      if (closedSet.has(neighbor.to)) continue

      const tentativeG = gScore.get(currentId)! + neighbor.distanceKm
      if (!openSet.has(neighbor.to)) {
        openSet.add(neighbor.to)
      } else if (tentativeG >= gScore.get(neighbor.to)!) {
        continue
      }

      cameFrom.set(neighbor.to, currentId)
      gScore.set(neighbor.to, tentativeG)
      fScore.set(neighbor.to, tentativeG + heuristic(neighbor.to))
    }
  }

  return {
    path: [],
    distanceKm: Infinity,
    nodesExpanded,
    durationMs: performance.now() - startTime,
  }
}
