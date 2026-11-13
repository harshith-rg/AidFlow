"""A* shortest-path routing algorithm on a directed RoadGraph.

This module implements the A* algorithm independently using Python's heapq.
It does not use NetworkX internally. It uses an admissible, consistent heuristic
scaled by the graph's precomputed heuristic factor:
    h(u, target) = graph.heuristic_factor * haversine_m(coords(u), coords(target))

Because the factor guarantees that h never overestimates remaining road distance,
A* is mathematically guaranteed to find the true shortest path and agree with
Dijkstra on path cost.
"""

import heapq
import math
from collections.abc import Callable
from typing import Any

from app.services.geo import haversine_m
from app.services.road_graph import Edge, RoadGraph, UnknownNodeError
from app.services.routing import PathNotFoundError, RouteResult, build_polyline

__all__ = ["astar"]


def astar(
    graph: RoadGraph,
    source: int,
    target: int,
    heuristic: Callable[[int, int], float] | None = None,
    overlay: Any = None,
) -> RouteResult:
    """Compute the shortest directed path from source to target using A*.

    Args:
        graph: The RoadGraph instance to route across.
        source: Starting node ID (integer).
        target: Destination node ID (integer).
        heuristic: Optional custom heuristic function (u, target) -> float.
            If None, the default admissible geographic heuristic is used:
            graph.heuristic_factor * haversine_m(coords(u), coords(target)).
        overlay: Optional TrafficOverlay for simulated congestion weights and road closures.

    Returns:
        RouteResult containing the node sequence, total physical distance in metres,
        traversed edges, full coordinate polyline, and optional effective cost.

    Raises:
        UnknownNodeError: If source or target is not in the graph.
        PathNotFoundError: If no directed path exists from source to target.
        TypeError: If graph is not a RoadGraph instance.
    """
    if not isinstance(graph, RoadGraph):
        raise TypeError(
            f"graph must be a RoadGraph instance, but got {type(graph).__name__}."
        )

    # 1. Validate that source and target nodes exist in the graph
    graph._require_node(source)
    graph._require_node(target)

    # 2. Source equals destination: zero distance, single-point polyline
    if source == target:
        coords = graph.coords(source)
        return RouteResult(
            nodes=(source,),
            total_distance_m=0.0,
            edges=(),
            polyline=(coords,),
            effective_cost_m=0.0 if overlay is not None else None,
        )

    # 3. Setup heuristic function
    target_lat, target_lng = graph.coords(target)
    factor = graph.heuristic_factor

    if heuristic is not None:
        h_func = heuristic
    elif factor > 0.0:

        def h_func(u: int, tgt: int) -> float:
            if u == tgt:
                return 0.0
            u_lat, u_lng = graph.coords(u)
            return factor * haversine_m(u_lat, u_lng, target_lat, target_lng)

    else:

        def h_func(u: int, tgt: int) -> float:
            return 0.0

    # 4. A* data structures
    # g_score: exact shortest distance from source to node discovered so far
    g_score: dict[int, float] = {source: 0.0}
    # predecessor: predecessor node and the Edge object taken to reach it
    predecessor: dict[int, tuple[int, Edge]] = {}
    # visited / settled nodes
    visited: set[int] = set()

    # Priority queue stores (f_score, g_score, node_id)
    # Breaking ties with g_score prefers nodes closer to goal;
    # breaking ties with node_id ensures deterministic order.
    h_source = h_func(source, target)
    heap: list[tuple[float, float, int]] = [(h_source, 0.0, source)]

    # 5. Main search loop
    while heap:
        f_u, g_u, u = heapq.heappop(heap)

        if u in visited:
            continue
        visited.add(u)

        if u == target:
            break

        # Best g_score for u
        current_g = g_score[u]

        for edge in graph.out_edges(u):
            if overlay is not None and overlay.is_edge_closed(edge):
                continue

            v = edge.target
            if v in visited:
                continue

            edge_cost = (
                edge.length_m
                if overlay is None
                else overlay.edge_effective_cost_m(edge, graph)
            )
            if not math.isfinite(edge_cost):
                continue

            new_g = current_g + edge_cost

            # Strict inequality ensures stable, deterministic predecessor choices
            if v not in g_score or new_g < g_score[v]:
                g_score[v] = new_g
                predecessor[v] = (u, edge)
                h_v = h_func(v, target)
                f_v = new_g + h_v
                heapq.heappush(heap, (f_v, new_g, v))

    # 6. Check if target was reached
    if target not in visited:
        raise PathNotFoundError(
            f"No road path exists from node {source} to node {target}."
        )

    # 7. Reconstruct path, edges, and polyline
    path_nodes: list[int] = [target]
    path_edges: list[Edge] = []
    curr = target

    while curr != source:
        prev_node, edge_taken = predecessor[curr]
        path_nodes.append(prev_node)
        path_edges.append(edge_taken)
        curr = prev_node

    path_nodes.reverse()
    path_edges.reverse()

    nodes_tuple = tuple(path_nodes)
    edges_tuple = tuple(path_edges)
    total_phys_dist = sum(e.length_m for e in edges_tuple) if path_edges else 0.0
    effective_dist = g_score[target]
    polyline = build_polyline(graph, nodes_tuple, edges_tuple)

    return RouteResult(
        nodes=nodes_tuple,
        total_distance_m=total_phys_dist,
        edges=edges_tuple,
        polyline=polyline,
        effective_cost_m=effective_dist if overlay is not None else None,
    )

