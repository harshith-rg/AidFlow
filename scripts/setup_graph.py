"""Setup script: installs the Bengaluru road network graph the service loads.

Ensures that app/data/graph/bengaluru_coverage_box.graphml exists and is non-empty
so the service, routing engine and real-map tests can run. This is the larger graph
(west 77.52, south 12.90, east 77.68, north 13.04; about 70 MB, 23 of the 37 demo
hospitals). The file is git-ignored and never committed.

Order of preference:
  1. keep the existing file at the target path;
  2. otherwise COPY phase0/output/bengaluru_coverage_box.graphml (the source file is
     left untouched);
  3. otherwise download the box from OpenStreetMap with OSMnx (needs internet; takes
     several minutes and a lot of memory).
"""

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

# Project paths
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.graph_loader import DEFAULT_GRAPH_PATH  # noqa: E402

# One source of truth: the path the service loads.
TARGET_GRAPH_FILE = DEFAULT_GRAPH_PATH
PHASE0_GRAPH_FILE = PROJECT_ROOT / "phase0" / "output" / "bengaluru_coverage_box.graphml"
CACHE_DIR = PROJECT_ROOT / "phase0" / "cache"

# The coverage box measured in Phase 0 (docs/PHASE0_REPORT.md).
DEFAULT_BBOX = {
    "west": 77.52,
    "south": 12.90,
    "east": 77.68,
    "north": 13.04,
}


def _temp_name(path: Path) -> Path:
    return path.with_name(path.name + ".part")


def download_graph(
    output_path: Path,
    bbox: dict[str, float] = DEFAULT_BBOX,
) -> None:
    """Download the road network directly from OSM using OSMnx."""
    try:
        import osmnx as ox
    except ImportError as err:
        sys.exit(
            f"Error: OSMnx is required to download the road network. "
            f"Install it with: pip install \"osmnx>=2.0\" ({err})"
        )

    print(
        f"Downloading road network for bounding box: "
        f"west={bbox['west']}, south={bbox['south']}, east={bbox['east']}, north={bbox['north']}."
    )
    print("This needs internet access and can take several minutes. Please wait...")
    start_time = time.perf_counter()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ox.settings.use_cache = True
    ox.settings.cache_folder = str(CACHE_DIR)
    ox.settings.log_console = False

    bbox_tuple = (bbox["west"], bbox["south"], bbox["east"], bbox["north"])
    try:
        graph = ox.graph_from_bbox(
            bbox_tuple, network_type="drive", retain_all=True
        )
    except Exception as err:
        sys.exit(f"Error: Failed to download road graph from OpenStreetMap: {err}")

    if graph.number_of_nodes() == 0:
        sys.exit("Error: Downloaded graph contains zero nodes. Check the bounding box coordinates.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Save to a temporary name first, so an interrupted run never leaves a half-written graph.
    partial = _temp_name(output_path)
    try:
        ox.save_graphml(graph, partial)
        os.replace(partial, output_path)
    except Exception as err:
        partial.unlink(missing_ok=True)
        sys.exit(f"Error: Failed to save GraphML file to {output_path}: {err}")

    elapsed = time.perf_counter() - start_time
    print(
        f"Downloaded and saved graph: {graph.number_of_nodes():,} nodes, "
        f"{graph.number_of_edges():,} edges in {elapsed:.1f} s."
    )


def _copy_graph(source: Path, target: Path) -> bool:
    """Copy source to target through a temporary file. The source is never changed."""
    partial = _temp_name(target)
    try:
        shutil.copy2(source, partial)
        if partial.stat().st_size != source.stat().st_size:
            partial.unlink(missing_ok=True)
            return False
        os.replace(partial, target)
    except OSError as err:
        partial.unlink(missing_ok=True)
        print(f"Copy failed ({err}).")
        return False
    return True


def setup_graph(force: bool = False, download: bool = False) -> None:
    """Ensure the target graph file is in place and non-empty."""
    TARGET_GRAPH_FILE.parent.mkdir(parents=True, exist_ok=True)

    # 1. If already valid and not forcing
    if TARGET_GRAPH_FILE.exists() and not force:
        size = TARGET_GRAPH_FILE.stat().st_size
        if size > 0:
            print(
                f"Road graph already exists and is ready: {TARGET_GRAPH_FILE} "
                f"({size / 1024 / 1024:.2f} MB)."
            )
            return
        print("Target graph file exists but is empty (0 bytes). Recreating...")

    # 2. Check if a phase0/output copy is available to avoid re-downloading
    if not download and PHASE0_GRAPH_FILE.exists():
        src_size = PHASE0_GRAPH_FILE.stat().st_size
        if src_size > 0:
            print(
                f"Installing road graph from existing Phase 0 output: "
                f"{PHASE0_GRAPH_FILE} -> {TARGET_GRAPH_FILE}"
            )
            if _copy_graph(PHASE0_GRAPH_FILE, TARGET_GRAPH_FILE):
                dest_size = TARGET_GRAPH_FILE.stat().st_size
                print(
                    f"Graph successfully installed: {TARGET_GRAPH_FILE} "
                    f"({dest_size / 1024 / 1024:.2f} MB)."
                )
                return
            print("Copy verification failed. Falling back to fresh download...")

    # 3. Download fresh from OpenStreetMap
    download_graph(TARGET_GRAPH_FILE)

    # 4. Final verification
    if not TARGET_GRAPH_FILE.exists():
        sys.exit(f"Error: Target file {TARGET_GRAPH_FILE} was not created.")

    final_size = TARGET_GRAPH_FILE.stat().st_size
    if final_size == 0:
        sys.exit(f"Error: Target file {TARGET_GRAPH_FILE} is empty (0 bytes).")

    print(
        f"Graph setup complete: {TARGET_GRAPH_FILE} "
        f"({final_size / 1024 / 1024:.2f} MB)."
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Set up the AidFlow road network GraphML file."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reinstall or redownload the graph even if already present.",
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Force a fresh download from OpenStreetMap instead of copying existing phase0 files.",
    )
    args = parser.parse_args()
    setup_graph(force=args.force, download=args.download)


if __name__ == "__main__":
    main()
