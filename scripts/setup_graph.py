"""Setup script: downloads or installs the Bengaluru road network graph.

Ensures that app/data/graph/bengaluru_small_full.graphml exists and is valid
so the service, routing engine, and agreement tests can run immediately.
"""

import argparse
import shutil
import sys
import time
from pathlib import Path

# Project paths
PROJECT_ROOT = Path(__file__).resolve().parents[1]
TARGET_GRAPH_FILE = (
    PROJECT_ROOT / "app" / "data" / "graph" / "bengaluru_small_full.graphml"
)
PHASE0_GRAPH_FILE = (
    PROJECT_ROOT / "phase0" / "output" / "bengaluru_small_full.graphml"
)
CACHE_DIR = PROJECT_ROOT / "phase0" / "cache"

# Default central Bengaluru bounding box
DEFAULT_BBOX = {
    "west": 77.56,
    "south": 12.96,
    "east": 77.62,
    "north": 13.00,
}


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
        f"west={bbox['west']}, south={bbox['south']}, east={bbox['east']}, north={bbox['north']}..."
    )
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
    try:
        ox.save_graphml(graph, output_path)
    except Exception as err:
        sys.exit(f"Error: Failed to save GraphML file to {output_path}: {err}")

    elapsed = time.perf_counter() - start_time
    print(
        f"✓ Downloaded and saved graph: {graph.number_of_nodes():,} nodes, "
        f"{graph.number_of_edges():,} edges in {elapsed:.1f} s."
    )


def setup_graph(force: bool = False, download: bool = False) -> None:
    """Ensure the target graph file is in place and non-empty."""
    TARGET_GRAPH_FILE.parent.mkdir(parents=True, exist_ok=True)

    # 1. If already valid and not forcing
    if TARGET_GRAPH_FILE.exists() and not force:
        size = TARGET_GRAPH_FILE.stat().st_size
        if size > 0:
            print(
                f"✓ Road graph already exists and is ready: {TARGET_GRAPH_FILE} "
                f"({size / 1024 / 1024:.2f} MB)."
            )
            return
        print(f"Target graph file exists but is empty (0 bytes). Recreating...")

    # 2. Check if phase0/output copy is available to avoid re-downloading
    if not download and PHASE0_GRAPH_FILE.exists():
        src_size = PHASE0_GRAPH_FILE.stat().st_size
        if src_size > 0:
            print(
                f"Installing road graph from existing Phase 0 output: "
                f"{PHASE0_GRAPH_FILE} -> {TARGET_GRAPH_FILE}"
            )
            shutil.copy2(PHASE0_GRAPH_FILE, TARGET_GRAPH_FILE)
            dest_size = TARGET_GRAPH_FILE.stat().st_size
            if dest_size == src_size and dest_size > 0:
                print(
                    f"✓ Graph successfully installed: {TARGET_GRAPH_FILE} "
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
        f"✓ Graph setup complete: {TARGET_GRAPH_FILE} "
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
