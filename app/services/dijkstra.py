"""Dijkstra shortest-path routing algorithm on a directed RoadGraph.

This module implements Dijkstra's algorithm from scratch using Python's heapq.
It does not use NetworkX internally. It respects one-way streets, uses length_m
as edge weights, and enforces deterministic tie-breaking.
"""

import heapq

from app.services.road_graph import Edge, RoadGraph, UnknownNodeError
from app.services.routing import PathNotFoundError, RouteResult, build_polyline

__all__ = ["dijkstra"]


def dijkstra(
    graph: RoadGraph,
    source: int,
    target: int,
) -> RouteResult:
    """Compute the shortest directed path from source to target using Dijkstra.

    Args:
        graph: The RoadGraph instance to route across.
        source: Starting node ID (integer).
        target: Destination node ID (integer).

    Returns:
        RouteResult containing the node sequence, total distance in metres,
        traversed edges, and full coordinate polyline.

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
        )

    # 3. Dijkstra data structures
    # dist: minimum known distance from source to node
    dist: dict[int, float] = {source: 0.0}
    # predecessor: predecessor node and the Edge object taken to reach it
    predecessor: dict[int, tuple[int, Edge]] = {}
    # visited / settled nodes
    visited: set[int] = set()
    # Min-heap stores (distance_from_source, node_id)
    # Including node_id breaks ties deterministically by lowest node ID
    heap: list[tuple[float, int]] = [(0.0, source)]

    # 4. Main search loop
    while heap:
        current_dist, u = heapq.heappop(heap)

        if u in visited:
            continue
        visited.add(u)

        if u == target:
            break

        for edge in graph.out_edges(u):
            v = edge.target
            if v in visited:
                continue

            new_dist = current_dist + edge.length_m
            # Strict inequality ensures stable, deterministic predecessor choices
            if v not in dist or new_dist < dist[v]:
                dist[v] = new_dist
                predecessor[v] = (u, edge)
                heapq.heappush(heap, (new_dist, v))

    # 5. Check if target was reached
    if target not in visited:
        raise PathNotFoundError(
            f"No road path exists from node {source} to node {target}."
        )

    # 6. Reconstruct path, edges, and polyline
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
    total_dist = dist[target]
    polyline = build_polyline(graph, nodes_tuple, edges_tuple)

    return RouteResult(
        nodes=nodes_tuple,
        total_distance_m=total_dist,
        edges=edges_tuple,
        polyline=polyline,
    )

