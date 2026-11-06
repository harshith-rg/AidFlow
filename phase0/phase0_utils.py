"""Shared settings and helpers for the Phase 0 road-network test."""

import json
import sys
from pathlib import Path

import networkx as nx
import osmnx as ox
import psutil

import os

# ---------------------------------------------------------------
# Test area bounding box.
# Default: central Bengaluru test box (west 77.56, south 12.96, east 77.62, north 13.00).
# Configurable via environment variables (AIDFLOW_BBOX_WEST, AIDFLOW_BBOX_SOUTH,
# AIDFLOW_BBOX_EAST, AIDFLOW_BBOX_NORTH) or CLI flags.
# ---------------------------------------------------------------
DEFAULT_BBOX = {"west": 77.56, "south": 12.96, "east": 77.62, "north": 13.00}


def get_configured_bbox(
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
) -> dict[str, float]:
    """Return bounding box from explicit arguments, environment variables, or defaults."""
    return {
        "west": float(
            west if west is not None else os.environ.get("AIDFLOW_BBOX_WEST", DEFAULT_BBOX["west"])
        ),
        "south": float(
            south if south is not None else os.environ.get("AIDFLOW_BBOX_SOUTH", DEFAULT_BBOX["south"])
        ),
        "east": float(
            east if east is not None else os.environ.get("AIDFLOW_BBOX_EAST", DEFAULT_BBOX["east"])
        ),
        "north": float(
            north if north is not None else os.environ.get("AIDFLOW_BBOX_NORTH", DEFAULT_BBOX["north"])
        ),
    }


BBOX = get_configured_bbox()

# Folder and file locations (relative to this file, so it works anywhere)
HERE = Path(__file__).resolve().parent
OUTPUT_DIR = HERE / "output"
CACHE_DIR = HERE / "cache"
GRAPH_FILE = OUTPUT_DIR / "bengaluru_small_full.graphml"  # NOT truncated
HOSPITALS_FILE = HERE.parent / "app" / "data" / "hospitals_demo.json"

# Speed from CONTRACT.md section 9 (used only to illustrate an ETA here)
AVERAGE_SPEED_KMH = 30

# Snapping warning threshold (metres)
SNAP_WARNING_M = 500


# ------------------------- measuring ---------------------------
def current_memory_mb() -> float:
    """Memory this Python program is using right now, in megabytes."""
    return psutil.Process().memory_info().rss / 1024 / 1024


def peak_memory_mb() -> float:
    """Highest memory this program has used so far, in megabytes."""
    info = psutil.Process().memory_info()
    if hasattr(info, "peak_wset"):  # Windows
        return info.peak_wset / 1024 / 1024
    import resource  # macOS / Linux

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        peak = peak / 1024  # macOS reports bytes, Linux reports kilobytes
    return peak / 1024


def folder_size_mb(folder: Path) -> float:
    """Total size of all files inside a folder, in megabytes."""
    total = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
    return total / 1024 / 1024


def file_size_mb(path: Path) -> float:
    """Size of one file, in megabytes."""
    return path.stat().st_size / 1024 / 1024


# ------------------------- printing ----------------------------
def print_report(title: str, results: dict) -> None:
    """Print a dictionary as a readable report (one level of nesting)."""
    print(f"\n========== {title} ==========")
    for key, value in results.items():
        if isinstance(value, dict):
            print(f"{key}:")
            for inner_key, inner_value in value.items():
                print(f"    {inner_key}: {inner_value}")
        else:
            print(f"{key}: {value}")
    print("=" * (22 + len(title)))


# ------------------------- hospitals ---------------------------
def is_inside_bbox(lat: float, lng: float) -> bool:
    """True if the point lies inside the test bounding box."""
    return (
        BBOX["south"] <= lat <= BBOX["north"]
        and BBOX["west"] <= lng <= BBOX["east"]
    )


def load_hospitals() -> list:
    """Read the demo dataset. We only READ it; it is never modified."""
    if not HOSPITALS_FILE.exists():
        sys.exit(f"Hospital file not found at: {HOSPITALS_FILE}")
    data = json.loads(HOSPITALS_FILE.read_text(encoding="utf-8"))
    return data["hospitals"]


def verify_required_hospitals(required_ids: list) -> list:
    """Print each required hospital's coordinates and check they are in
    the bounding box. Stops the program if one is missing or outside."""
    by_id = {h["hospital_id"]: h for h in load_hospitals()}
    print("Checking required hospitals against the test bounding box:")
    print(
        f"  Box: south={BBOX['south']}, north={BBOX['north']}, "
        f"west={BBOX['west']}, east={BBOX['east']}"
    )
    found = []
    problems = []
    for hospital_id in required_ids:
        if hospital_id not in by_id:
            problems.append(f"{hospital_id} is not in hospitals_demo.json")
            continue
        h = by_id[hospital_id]
        lat, lng = h["location"]["lat"], h["location"]["lng"]
        inside = is_inside_bbox(lat, lng)
        print(
            f"  {hospital_id} {h['name']}: lat={lat}, lng={lng} -> "
            f"{'INSIDE' if inside else 'OUTSIDE'}"
        )
        if not inside:
            problems.append(f"{hospital_id} is outside the bounding box")
        found.append(h)
    if problems:
        sys.exit("Cannot continue: " + "; ".join(problems))
    return found


def hospitals_inside_bbox() -> list:
    """All demo hospitals whose coordinates fall inside the test box."""
    return [
        h
        for h in load_hospitals()
        if is_inside_bbox(h["location"]["lat"], h["location"]["lng"])
    ]


# ------------------------- graph helpers -----------------------
def snap_hospital(graph, hospital: dict):
    """Find the nearest road node to the hospital's ORIGINAL coordinates.
    Returns (node_id, distance_in_metres). Nothing is changed in the dataset."""
    lat = hospital["location"]["lat"]
    lng = hospital["location"]["lng"]
    node = ox.distance.nearest_nodes(graph, X=lng, Y=lat)
    node_lat = graph.nodes[node]["y"]
    node_lng = graph.nodes[node]["x"]
    snap_m = ox.distance.great_circle(lat, lng, node_lat, node_lng)
    return node, snap_m


def largest_strong_component_nodes(graph) -> set:
    """Nodes of the biggest group where you can drive from any node to any
    other node while obeying one-way streets."""
    return max(nx.strongly_connected_components(graph), key=len)


def connectivity_stats(graph) -> dict:
    """Connectivity numbers. Nothing is removed from the graph."""
    total = graph.number_of_nodes()
    weak = sorted(
        (len(c) for c in nx.weakly_connected_components(graph)), reverse=True
    )
    strong = sorted(
        (len(c) for c in nx.strongly_connected_components(graph)), reverse=True
    )
    return {
        "nodes_total": total,
        "weak_components_count": len(weak),
        "largest_weak_component_nodes": weak[0],
        "largest_weak_component_percent": round(100 * weak[0] / total, 1),
        "strong_components_count": len(strong),
        "largest_strong_component_nodes": strong[0],
        "largest_strong_component_percent": round(100 * strong[0] / total, 1),
        "nodes_outside_largest_strong_component": total - strong[0],
        "five_biggest_strong_component_sizes": strong[:5],
        "strong_components_with_one_node": sum(1 for s in strong if s == 1),
    }


def road_length_stats(graph) -> dict:
    """Road length measured two ways (see the labels)."""
    # 1) Every directed edge added up. A two-way road is stored as two
    #    edges (one each way), so it is counted twice here.
    directed_km = (
        sum(d.get("length", 0) for _, _, d in graph.edges(data=True)) / 1000
    )

    # 2) Estimate of unique physical road length: merge the two directions
    #    of two-way roads into one, then add up.
    undirected = ox.convert.to_undirected(graph)
    unique_km = (
        sum(d.get("length", 0) for _, _, d in undirected.edges(data=True))
        / 1000
    )

    # Edges that have no reverse edge: these behave like one-way streets.
    edges_total = graph.number_of_edges()
    without_reverse = sum(1 for u, v in graph.edges() if not graph.has_edge(v, u))

    return {
        "total_directed_edge_length_km_(two-way roads counted twice)": round(
            directed_km, 1
        ),
        "estimated_unique_physical_road_km_(approximate)": round(unique_km, 1),
        "edges_total": edges_total,
        "edges_without_a_reverse_edge_(one-way-like)": without_reverse,
        "one_way_like_percent": round(100 * without_reverse / edges_total, 1),
    }