"""Phase 0, script 2: load the saved COMPLETE graph and check it."""

import json
import sys
import time

import networkx as nx
import osmnx as ox

from phase0_utils import (
    AVERAGE_SPEED_KMH,
    GRAPH_FILE,
    OUTPUT_DIR,
    SNAP_WARNING_M,
    connectivity_stats,
    current_memory_mb,
    hospitals_inside_bbox,
    largest_strong_component_nodes,
    peak_memory_mb,
    print_report,
    snap_hospital,
)


def measure_one_direction(graph, from_node, to_node, label):
    """Find a shortest road path one way. Returns (info_dict, route_or_None).
    "No path" is a normal finding here, not a crash."""
    try:
        route = nx.shortest_path(graph, from_node, to_node, weight="length")
        road_m = nx.shortest_path_length(graph, from_node, to_node, weight="length")
    except nx.NetworkXNoPath:
        return {"direction": label, "result": "NO ROAD PATH FOUND"}, None

    # Straight line between the SNAPPED road nodes (the same two points
    # the road route connects), so the comparison is fair.
    a, b = graph.nodes[from_node], graph.nodes[to_node]
    straight_m = ox.distance.great_circle(a["y"], a["x"], b["y"], b["x"])

    info = {
        "direction": label,
        "road_distance_km": round(road_m / 1000, 2),
        "straight_line_between_snapped_nodes_km": round(straight_m / 1000, 2),
        "road_to_straight_ratio": (
            round(road_m / straight_m, 2) if straight_m > 0 else "same node"
        ),
        "illustrative_eta_min_(30_kmh_no_traffic)": round(
            road_m / 1000 / AVERAGE_SPEED_KMH * 60, 1
        ),
        "nodes_on_route": len(route),
    }
    return info, route


def main() -> None:
    if not GRAPH_FILE.exists():
        sys.exit("Graph file not found. Run phase0_download.py first.")

    # ---- Step 1: load the graph (like the real service at startup) ----
    memory_before = current_memory_mb()
    start = time.perf_counter()
    graph = ox.load_graphml(GRAPH_FILE)
    load_seconds = time.perf_counter() - start
    memory_after = current_memory_mb()

    if graph.number_of_nodes() == 0:
        sys.exit("The loaded graph is empty.")

    print(f"Loaded graph in {load_seconds:.1f} s")
    print(f"Nodes: {graph.number_of_nodes()}, directed edges: {graph.number_of_edges()}")

    # ---- Step 2: connectivity (measured only, nothing removed) --------
    connectivity = connectivity_stats(graph)
    biggest_group = largest_strong_component_nodes(graph)

    # ---- Step 3: snap every demo hospital that lies inside the box ----
    # The dataset is only READ. Its coordinates stay exactly as they are.
    inside = hospitals_inside_bbox()
    print(f"\nHospitals inside the test box: {len(inside)}")

    snapped = []
    snap_report = {}
    for h in inside:
        node, snap_m = snap_hospital(graph, h)
        in_main = node in biggest_group
        snapped.append((h, node))
        warning = "  <-- far from a road" if snap_m > SNAP_WARNING_M else ""
        snap_report[h["hospital_id"]] = {
            "original_coordinate_to_nearest_road_node_m": round(snap_m),
            "snapped_node": node,
            "node_in_largest_strong_component": in_main,
            "note": warning.strip(),
        }
        print(
            f"  {h['hospital_id']} {h['name']}: nearest road node {snap_m:.0f} m away"
            f" (in main drivable network: {in_main}){warning}"
        )

    # ---- Step 4: sample route, BOTH directions -------------------------
    # One-way streets mean A->B can differ from B->A, so we test both.
    # (This is NetworkX as a sanity check. It is NOT our own A*.)
    routes_report = []
    first_route = None
    if len(snapped) >= 2:
        (h1, n1), (h2, n2) = snapped[0], snapped[1]
        id1, id2 = h1["hospital_id"], h2["hospital_id"]
        print(f"\nSample routes between {id1} and {id2} (snapped road nodes):")
        for from_n, to_n, label in [(n1, n2, f"{id1} -> {id2}"), (n2, n1, f"{id2} -> {id1}")]:
            info, route = measure_one_direction(graph, from_n, to_n, label)
            routes_report.append(info)
            if route is not None and first_route is None:
                first_route = route
            for key, value in info.items():
                print(f"  {key}: {value}")
            print()
        if first_route is not None:
            picture = OUTPUT_DIR / "phase0_route.png"
            try:
                ox.plot_graph_route(
                    graph, first_route, node_size=0, show=False, close=True,
                    save=True, filepath=str(picture),
                )
                print(f"Picture saved to: {picture}")
            except Exception as error:  # the picture is only a bonus
                print(f"(Could not draw picture: {error})")
    else:
        print("\nFewer than 2 hospitals in the box, so no sample route.")

    results = {
        "load_seconds": round(load_seconds, 1),
        "memory_before_load_mb": round(memory_before, 0),
        "memory_after_load_mb": round(memory_after, 0),
        "memory_used_by_graph_mb": round(memory_after - memory_before, 0),
        "peak_memory_mb": round(peak_memory_mb(), 0),
        "nodes": graph.number_of_nodes(),
        "edges_(directed)": graph.number_of_edges(),
        "connectivity_(nothing_was_removed)": connectivity,
    }
    print_report("PHASE 0 CHECK REPORT", results)
    print_report("HOSPITAL SNAPPING", snap_report)

    (OUTPUT_DIR / "phase0_check_results.json").write_text(
        json.dumps(
            {**results, "hospital_snapping": snap_report, "sample_routes": routes_report},
            indent=2,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()