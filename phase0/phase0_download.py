"""Phase 0, script 1: download a small road network and measure it.

The downloaded graph is kept COMPLETE: no roads are thrown away to make
it look connected. Connectivity is only measured and reported.
"""

import json
import sys
import time

import osmnx as ox

from phase0_utils import (
    BBOX,
    CACHE_DIR,
    GRAPH_FILE,
    OUTPUT_DIR,
    SNAP_WARNING_M,
    connectivity_stats,
    current_memory_mb,
    file_size_mb,
    folder_size_mb,
    peak_memory_mb,
    print_report,
    road_length_stats,
    snap_hospital,
    verify_required_hospitals,
)


def main() -> None:
    # This code is written for OSMnx version 2 or newer.
    if int(ox.__version__.split(".")[0]) < 2:
        sys.exit("Please upgrade: pip install --upgrade 'osmnx>=2.0'")

    # ---- Step 0: check the hospitals BEFORE downloading anything -----
    # (This stops with a clear message if H01 or H02 is outside the box.)
    required = verify_required_hospitals(["H01", "H02"])

    OUTPUT_DIR.mkdir(exist_ok=True)
    CACHE_DIR.mkdir(exist_ok=True)

    # OSMnx saves what it downloads in the cache folder. We measure that
    # folder's growth, which roughly tells us how much data was downloaded.
    ox.settings.use_cache = True
    ox.settings.cache_folder = str(CACHE_DIR)
    ox.settings.log_console = True  # prints progress messages

    cache_before = folder_size_mb(CACHE_DIR)
    memory_start = current_memory_mb()

    # ---- Step 1: download + build the graph --------------------------
    # network_type="drive": roads that cars (and ambulances) can use.
    # retain_all=True: KEEP every piece of road, even small pieces that
    #   are disconnected. (OSMnx's default, False, would silently delete
    #   them, which is exactly what we do not want.)
    # bbox order for OSMnx 2 is (west, south, east, north).
    print("\nDownloading roads... (this can take a minute or more)")
    bbox = (BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"])
    start = time.perf_counter()
    graph = ox.graph_from_bbox(bbox, network_type="drive", retain_all=True)
    build_seconds = time.perf_counter() - start

    cache_after = folder_size_mb(CACHE_DIR)
    memory_after_build = current_memory_mb()

    if graph.number_of_nodes() == 0:
        sys.exit("The downloaded graph is empty. Try again or check the bbox.")

    # ---- Step 2: save the COMPLETE graph (nothing removed) -----------
    start = time.perf_counter()
    ox.save_graphml(graph, GRAPH_FILE)
    save_seconds = time.perf_counter() - start

    # ---- Step 3: measure (these only READ the graph) -----------------
    connectivity = connectivity_stats(graph)
    lengths = road_length_stats(graph)

    # ---- Step 4: how far are H01/H02 from their nearest road node? ---
    snap_report = {}
    for h in required:
        node, snap_m = snap_hospital(graph, h)
        note = "  <-- WARNING: far from a road" if snap_m > SNAP_WARNING_M else ""
        snap_report[h["hospital_id"]] = f"{snap_m:.0f} m to node {node}{note}"

    results = {
        "osmnx_version": ox.__version__,
        "bbox": BBOX,
        "download_and_build_seconds": round(build_seconds, 1),
        "downloaded_data_mb_(cache_growth)": round(cache_after - cache_before, 2),
        "save_seconds": round(save_seconds, 1),
        "graph_file_mb": round(file_size_mb(GRAPH_FILE), 2),
        "nodes": graph.number_of_nodes(),
        "edges_(directed)": graph.number_of_edges(),
        "memory_at_start_mb": round(memory_start, 0),
        "memory_after_build_mb": round(memory_after_build, 0),
        "peak_memory_mb": round(peak_memory_mb(), 0),
        "connectivity_(nothing_was_removed)": connectivity,
        "road_length": lengths,
        "hospital_original_coordinate_to_nearest_road_node": snap_report,
    }

    print_report("PHASE 0 DOWNLOAD REPORT", results)
    print(f"Complete graph saved to: {GRAPH_FILE}")

    if results["downloaded_data_mb_(cache_growth)"] == 0:
        print(
            "\nNote: download size is 0 because this area was already in the "
            "cache. The time shown is then mostly processing time."
        )

    (OUTPUT_DIR / "phase0_download_results.json").write_text(
        json.dumps(results, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()