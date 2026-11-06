"""Measure and report on an expanded road-network coverage box.

Downloads the specified bounding box (default: west 77.52, south 12.90, east 77.68, north 13.04),
measures nodes, edges, file size, load time, peak memory via graph_loader,
and evaluates hospital snapping and strong-component connectivity.
"""

import argparse
import json
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import networkx as nx
import osmnx as ox
import psutil

from app.data.hospital_repository import load_repository
from app.services.graph_loader import load_road_graph
from app.services.snapping import snap_hospital

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "phase0" / "output"
CACHE_DIR = PROJECT_ROOT / "phase0" / "cache"
OUTPUT_GRAPH_FILE = OUTPUT_DIR / "bengaluru_coverage_box.graphml"

# User's chosen bounding box
CHOSEN_BBOX = {
    "west": 77.52,
    "south": 12.90,
    "east": 77.68,
    "north": 13.04,
}


def current_memory_mb() -> float:
    return psutil.Process().memory_info().rss / 1024 / 1024


def peak_memory_mb() -> float:
    info = psutil.Process().memory_info()
    if hasattr(info, "peak_wset"):  # Windows
        return info.peak_wset / 1024 / 1024
    import resource

    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def run_measurement(bbox: dict[str, float], output_file: Path = OUTPUT_GRAPH_FILE) -> dict:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    ox.settings.use_cache = True
    ox.settings.cache_folder = str(CACHE_DIR)
    ox.settings.log_console = False

    print("=" * 70)
    print("  MEASURING COVERAGE BOX FOR AIDFLOW")
    print(f"  Box: west={bbox['west']}, south={bbox['south']}, east={bbox['east']}, north={bbox['north']}")
    print("=" * 70)

    # 1. Identify hospitals inside box
    repo = load_repository()
    all_hospitals = repo.all()
    inside_hospitals = [
        h
        for h in all_hospitals
        if bbox["south"] <= h.location.lat <= bbox["north"]
        and bbox["west"] <= h.location.lng <= bbox["east"]
    ]
    inside_ids = [h.hospital_id for h in inside_hospitals]
    print(f"\n1. Hospitals inside bounding box: {len(inside_hospitals)} / {len(all_hospitals)}")
    print(f"   Hospital IDs: {', '.join(inside_ids)}")

    # 2. Download / Build Graph
    bbox_tuple = (bbox["west"], bbox["south"], bbox["east"], bbox["north"])
    print("\n2. Downloading road network with OSMnx (network_type='drive', retain_all=True)...")
    t0 = time.perf_counter()
    raw_graph = ox.graph_from_bbox(bbox_tuple, network_type="drive", retain_all=True)
    download_time = time.perf_counter() - t0
    print(f"   ✓ Downloaded/built in {download_time:.1f} s")
    print(f"   • Raw nodes: {raw_graph.number_of_nodes():,}")
    print(f"   • Raw edges: {raw_graph.number_of_edges():,}")

    # 3. Save GraphML
    print(f"\n3. Saving GraphML to {output_file}...")
    t0 = time.perf_counter()
    ox.save_graphml(raw_graph, output_file)
    save_time = time.perf_counter() - t0
    file_size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"   ✓ Saved in {save_time:.1f} s. File size: {file_size_mb:.2f} MB")

    # 4. Load through our graph_loader
    print("\n4. Loading through app.services.graph_loader.load_road_graph...")
    mem_before = current_memory_mb()
    t0 = time.perf_counter()
    road_graph = load_road_graph(output_file)
    loader_time = time.perf_counter() - t0
    mem_after = current_memory_mb()
    peak_mem = peak_memory_mb()

    print(f"   ✓ Loaded in {loader_time:.2f} s")
    print(f"   • RoadGraph nodes : {road_graph.node_count:,}")
    print(f"   • RoadGraph edges : {road_graph.edge_count:,}")
    print(f"   • Heuristic factor: {road_graph.heuristic_factor:.6f}")
    print(f"   • Memory before   : {mem_before:.1f} MB")
    print(f"   • Memory after    : {mem_after:.1f} MB (diff: {mem_after - mem_before:.1f} MB)")
    print(f"   • Peak process mem: {peak_mem:.1f} MB")

    # 5. Connectivity analysis
    print("\n5. Analyzing connectivity components...")
    # Convert to standard MultiDiGraph for component analysis
    strongly_connected = list(nx.strongly_connected_components(raw_graph))
    largest_scc = max(strongly_connected, key=len)
    scc_pct = len(largest_scc) / raw_graph.number_of_nodes() * 100.0
    print(f"   • Total strongly connected components: {len(strongly_connected)}")
    print(f"   • Largest strongly connected component: {len(largest_scc):,} nodes ({scc_pct:.1f}%)")

    # 6. Hospital snapping & connectivity check
    print("\n6. Hospital Snapping and Reachability Check:")
    snapping_results = {}
    far_hospitals = []
    disconnected_hospitals = []

    for h in inside_hospitals:
        snap_res = snap_hospital(road_graph, h)
        in_main_scc = snap_res.node_id in largest_scc
        snapping_results[h.hospital_id] = {
            "name": h.name,
            "locality": h.locality,
            "distance_m": round(snap_res.distance_m, 1),
            "snapped_node": snap_res.node_id,
            "in_largest_scc": in_main_scc,
        }
        note = ""
        if snap_res.distance_m > 500.0:
            far_hospitals.append((h.hospital_id, snap_res.distance_m))
            note += " [FAR > 500m]"
        if not in_main_scc:
            disconnected_hospitals.append((h.hospital_id, snap_res.node_id))
            note += " [DISCONNECTED from main component]"

        print(
            f"   - [{h.hospital_id}] {h.name}: {snap_res.distance_m:.1f} m to node {snap_res.node_id} "
            f"(in main network: {in_main_scc}){note}"
        )

    summary = {
        "bbox": bbox,
        "hospitals_inside_count": len(inside_hospitals),
        "hospitals_inside_ids": inside_ids,
        "raw_nodes": raw_graph.number_of_nodes(),
        "raw_edges": raw_graph.number_of_edges(),
        "clean_nodes": road_graph.node_count,
        "clean_edges": road_graph.edge_count,
        "file_size_mb": round(file_size_mb, 2),
        "download_seconds": round(download_time, 1),
        "save_seconds": round(save_time, 1),
        "load_seconds": round(loader_time, 2),
        "peak_memory_mb": round(peak_mem, 1),
        "largest_scc_nodes": len(largest_scc),
        "largest_scc_percent": round(scc_pct, 1),
        "hospitals_far_over_500m": far_hospitals,
        "hospitals_disconnected": disconnected_hospitals,
        "snapping": snapping_results,
    }

    report_path = OUTPUT_DIR / "coverage_box_report.json"
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n✓ Saved full measurement report to: {report_path}")

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure coverage box for AidFlow.")
    parser.add_argument("--west", type=float, default=CHOSEN_BBOX["west"])
    parser.add_argument("--south", type=float, default=CHOSEN_BBOX["south"])
    parser.add_argument("--east", type=float, default=CHOSEN_BBOX["east"])
    parser.add_argument("--north", type=float, default=CHOSEN_BBOX["north"])
    parser.add_argument("--output", type=str, default=str(OUTPUT_GRAPH_FILE))
    args = parser.parse_args()

    bbox = {
        "west": args.west,
        "south": args.south,
        "east": args.east,
        "north": args.north,
    }
    run_measurement(bbox, output_file=Path(args.output))


if __name__ == "__main__":
    main()
