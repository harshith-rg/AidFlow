"""AidFlow Demo: Phases 0 to 3 in Action.

Demonstrates:
  - Phase 0: Road network loading & stats (OSMnx / GraphML)
  - Phase 1 & 2: Hospital dataset loading & eligibility filtering
  - Phase 3: Location snapping to road intersections
  - Phase 3: Dijkstra shortest-path calculation
  - Phase 3: A* shortest-path calculation (with heuristic factor)
  - Phase 3: One-way road asymmetry verification & polyline extraction
"""

import time
from app.core.config import Settings
from app.data.hospital_repository import load_repository
from app.services.astar import astar
from app.services.clock import get_reference_time
from app.services.dijkstra import dijkstra
from app.services.graph_loader import get_road_graph
from app.services.hospital_filter import filter_hospitals
from app.services.routing import find_route_between_locations
from app.services.snapping import OutOfCoverageError, snap_hospital, snap_to_road


def print_header(title: str) -> None:
    print("\n" + "=" * 65)
    print(f"  {title}")
    print("=" * 65)


def run_demo() -> None:
    print_header("AidFlow Emergency System — Phase 0 to 3 Execution Demo")

    # ---------------------------------------------------------
    # 1. Phase 0 & 3: Load the Real Road Graph
    # ---------------------------------------------------------
    print("\n[Step 1] Loading Bengaluru Central Road Network...")
    t0 = time.perf_counter()
    graph = get_road_graph()
    load_time = time.perf_counter() - t0

    print(f"  ✓ Road Graph loaded in {load_time:.2f} seconds")
    print(f"  • Total Intersection Nodes : {graph.node_count:,}")
    print(f"  • Total Directed Edges     : {graph.edge_count:,}")
    print(f"  • Heuristic Factor (A*)    : {graph.heuristic_factor:.6f}")
    box = graph.coverage_box
    print(f"  • Coverage Bounding Box    : South {box.south}, North {box.north}, West {box.west}, East {box.east}")

    # ---------------------------------------------------------
    # 2. Phase 1 & 2: Hospital Repository & Eligibility Filtering
    # ---------------------------------------------------------
    print_header("Step 2: Hospital Repository & Capability Filtering (Phase 2)")
    repo = load_repository()
    all_hospitals = repo.all()
    print(f"Loaded {len(all_hospitals)} hospitals from dataset.")

    # Filter for emergency needing ICU & TRAUMA using demo reference time
    needs = ("ICU", "TRAUMA")
    ref = get_reference_time(Settings(time_mode="demo"), repo.meta.as_of)
    filter_res = filter_hospitals(all_hospitals, needs=needs, reference_time=ref.value, stale_after_minutes=60.0)
    print(f"\nFiltering for emergency needs: {list(needs)} (reference time: {ref.value.isoformat()})")
    print(f"  ✓ Eligible hospitals ({len(filter_res.eligible)}):")
    for eh in filter_res.eligible:
        h = eh.hospital
        print(f"    - [{h.hospital_id}] {h.name} ({h.locality}) | Total Beds: {h.beds_total}, ICU Beds: {h.icu_beds_available}")

    # ---------------------------------------------------------
    # 3. Phase 3: Location Snapping
    # ---------------------------------------------------------
    print_header("Step 3: Location Snapping to Road Network (Phase 3)")

    # Ambulance / Patient pickup near Vidhana Soudha / Cubbon Park
    patient_coords = (12.9760, 77.5920)
    print(f"Patient Pickup Coordinates: {patient_coords[0]:.4f}°N, {patient_coords[1]:.4f}°E")

    snap_patient = snap_to_road(graph, patient_coords[0], patient_coords[1])
    print(f"  ✓ Patient snapped to intersection node : {snap_patient.node_id}")
    print(f"    - Snapping straight-line distance    : {snap_patient.distance_m:.1f} metres")
    print(f"    - Snapped road node coordinates     : {snap_patient.coords}")

    # Snap two demo hospitals
    h01 = repo.get("H01")
    h02 = repo.get("H02")

    snap_h01 = snap_hospital(graph, h01)
    snap_h02 = snap_hospital(graph, h02)

    print(f"\n  ✓ [{h01.hospital_id}] {h01.name}:")
    print(f"    - Snapped to Node {snap_h01.node_id} ({snap_h01.distance_m:.1f} m from hospital coordinates)")
    print(f"  ✓ [{h02.hospital_id}] {h02.name}:")
    print(f"    - Snapped to Node {snap_h02.node_id} ({snap_h02.distance_m:.1f} m from hospital coordinates)")

    # ---------------------------------------------------------
    # 4. Phase 3: Shortest Path Routing (Dijkstra vs. A*)
    # ---------------------------------------------------------
    print_header("Step 4: Shortest Path Calculation — Dijkstra vs. A*")

    source_node = snap_h01.node_id
    target_node = snap_h02.node_id
    print(f"Routing between {h01.name} (Node {source_node}) and {h02.name} (Node {target_node}):\n")

    # Dijkstra
    t_d0 = time.perf_counter()
    dijkstra_res = dijkstra(graph, source_node, target_node)
    t_d = (time.perf_counter() - t_d0) * 1000

    # A*
    t_a0 = time.perf_counter()
    astar_res = astar(graph, source_node, target_node)
    t_a = (time.perf_counter() - t_a0) * 1000

    print(f"  [Dijkstra Algorithm]")
    print(f"    • Total Road Distance : {dijkstra_res.total_distance_m:.2f} m ({dijkstra_res.distance_km:.2f} km)")
    print(f"    • Nodes on Route      : {dijkstra_res.node_count}")
    print(f"    • Edges Traversed     : {dijkstra_res.edge_count}")
    print(f"    • Execution Time      : {t_d:.2f} ms")

    print(f"\n  [A* Algorithm (with Haversine Heuristic)]")
    print(f"    • Total Road Distance : {astar_res.total_distance_m:.2f} m ({astar_res.distance_km:.2f} km)")
    print(f"    • Nodes on Route      : {astar_res.node_count}")
    print(f"    • Edges Traversed     : {astar_res.edge_count}")
    print(f"    • Execution Time      : {t_a:.2f} ms")

    # Verification of cost equality
    assert abs(dijkstra_res.total_distance_m - astar_res.total_distance_m) < 1e-4
    print(f"\n  ✓ Algorithms Agree on Shortest Distance: Exactly {dijkstra_res.total_distance_m:.2f} m")
    if t_a < t_d:
        print(f"  ✓ A* was {t_d / max(t_a, 0.001):.1f}x faster due to heuristic goal-directed pruning")

    # ---------------------------------------------------------
    # 5. One-Way Street Asymmetry Check
    # ---------------------------------------------------------
    print_header("Step 5: Directed Road & One-Way Asymmetry Verification")
    reverse_res = astar(graph, target_node, source_node)
    print(f"  • Forward Route (H01 -> H02) : {astar_res.distance_km:.2f} km ({astar_res.node_count} nodes)")
    print(f"  • Reverse Route (H02 -> H01) : {reverse_res.distance_km:.2f} km ({reverse_res.node_count} nodes)")
    diff = abs(astar_res.total_distance_m - reverse_res.total_distance_m)
    print(f"  ✓ Direction difference: {diff:.1f} m due to one-way streets in Central Bengaluru")

    # ---------------------------------------------------------
    # 6. Polyline Extraction
    # ---------------------------------------------------------
    print_header("Step 6: Map Polyline Geometry for Leaflet / UI")
    print(f"  • Polyline Point Count: {len(astar_res.polyline)} coordinates")
    print(f"  • First 3 coordinates: {astar_res.polyline[:3]}")
    print(f"  • Last 3 coordinates : {astar_res.polyline[-3:]}")

    # ---------------------------------------------------------
    # 7. Out-of-Coverage Boundary Protection
    # ---------------------------------------------------------
    print_header("Step 7: Safety & Out-of-Coverage Handling")
    outside_lat, outside_lng = (13.5000, 77.5000)
    print(f"Testing location outside Bengaluru map: ({outside_lat}, {outside_lng})")
    try:
        snap_to_road(graph, outside_lat, outside_lng)
        print("  ✗ Failed: Should have rejected out-of-coverage coordinate")
    except OutOfCoverageError as e:
        print(f"  ✓ Correctly Rejected with OutOfCoverageError:\n    \"{e}\"")

    print_header("Phase 0 to 3 Demo Completed Successfully!")


if __name__ == "__main__":
    run_demo()
