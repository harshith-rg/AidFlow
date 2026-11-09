"""Time POST /recommend-hospital on an existing GraphML road graph (READ-ONLY).

What it does
- Reads ONE existing GraphML file. It never downloads, writes, replaces or
  moves any graph or any other file, and it needs no internet connection.
- Loads the graph once, then calls the real endpoint in-process (FastAPI
  TestClient) for several pickup points, using the demo clock.
- Prints timings and memory. It prints only; it creates no files.

Run it from the project folder (Windows Command Prompt):

    python scripts\\measure_recommend.py --graph phase0\\output\\bengaluru_coverage_box.graphml

Timings include request checking, snapping, A* to every eligible hospital,
ranking and building the JSON response. They do not include network time.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import warnings

import psutil

warnings.filterwarnings("ignore", message=".*httpx.*")  # harmless test-client notice
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.data.hospital_repository import load_repository
from app.main import create_app
from app.services.graph_loader import GraphError, load_road_graph
from app.services.snapping import OutOfCoverageError, snap_hospital

DEFAULT_GRAPH = PROJECT_ROOT / "phase0" / "output" / "bengaluru_coverage_box.graphml"

# Pickup points inside the larger coverage box (west 77.52, south 12.90, east 77.68, north 13.04).
ORIGINS = [
    ("Majestic", 12.9767, 77.5713),
    ("Indiranagar", 12.9784, 77.6408),
    ("Koramangala", 12.9352, 77.6245),
    ("Hebbal", 13.0358, 77.5970),
    ("Jayanagar", 12.9250, 77.5938),
]

# "[]" (any open hospital) is the heaviest case: it routes to every hospital in the graph.
NEEDS_CASES = [
    ("any open hospital", []),
    ("ICU", ["ICU"]),
    ("ICU + TRAUMA", ["ICU", "TRAUMA"]),
]


def memory_mb() -> tuple[float, float]:
    """Return (current, peak) memory of this process in MB."""
    info = psutil.Process().memory_info()
    current = info.rss / 1024 / 1024
    if hasattr(info, "peak_wset"):  # Windows
        peak = info.peak_wset / 1024 / 1024
    else:
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    return current, peak


def ms(seconds: float) -> float:
    return seconds * 1000.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--graph", type=Path, default=DEFAULT_GRAPH, help="existing GraphML file")
    parser.add_argument("--repeat", type=int, default=5, help="calls per case after the first (default 5)")
    args = parser.parse_args()

    graph_path = args.graph if args.graph.is_absolute() else Path.cwd() / args.graph
    if not graph_path.is_file():
        print(f"ERROR: graph file not found: {graph_path}")
        print("This script never downloads or creates a graph. Nothing was changed.")
        return 2
    if args.repeat < 1:
        print("ERROR: --repeat must be at least 1.")
        return 2

    print("AidFlow POST /recommend-hospital timing (read-only)")
    print(f"Graph file : {graph_path}")
    print(f"File size  : {graph_path.stat().st_size / 1024 / 1024:.2f} MB")

    # 1. Load the graph once (this is also what the server does on its first request).
    started = time.perf_counter()
    try:
        graph = load_road_graph(graph_path)
    except GraphError as error:
        print(f"ERROR: could not read the graph: {error}")
        return 2
    load_seconds = time.perf_counter() - started
    current_mb, peak_mb = memory_mb()
    print(f"Graph load : {load_seconds:.2f} s, {graph.node_count} nodes")
    print(f"Memory     : {current_mb:.0f} MB now, {peak_mb:.0f} MB peak")

    # 2. Which demo hospitals can this graph reach?
    repo = load_repository()
    reachable = []
    for hospital in repo.all():
        try:
            snap_hospital(graph, hospital)
            reachable.append(hospital.hospital_id)
        except OutOfCoverageError:
            pass
    total = len(list(repo.all()))
    print(f"Hospitals inside this graph: {len(reachable)} of {total}")
    print()

    # 3. Call the real endpoint in-process. The graph is handed over directly,
    #    so no file is read again and nothing is written.
    app = create_app(Settings(time_mode="demo"))
    all_calls: list[float] = []
    first_calls: list[float] = []
    failures = 0

    header = f"{'Pickup':<12} {'Needs':<18} {'Status':<7} {'First ms':>9} {'Median ms':>10} {'Max ms':>8}  Recommended"
    print(header)
    print("-" * len(header))

    with patch("app.api.routes.get_road_graph", lambda *a, **k: graph):
        client = TestClient(app)
        for place, lat, lng in ORIGINS:
            for label, needs in NEEDS_CASES:
                body = {"origin": {"lat": lat, "lng": lng}, "needs": needs, "max_alternatives": 2}
                timings = []
                status = None
                recommended = "-"
                for call in range(args.repeat + 1):
                    t0 = time.perf_counter()
                    response = client.post("/recommend-hospital", json=body)
                    timings.append(time.perf_counter() - t0)
                    status = response.status_code
                    if call == 0:
                        if status == 200:
                            rec = response.json()["recommended"]
                            recommended = f"{rec['hospital_id']} ({rec['eta_min']} min)"
                        else:
                            recommended = response.json().get("error", {}).get("code", "?")
                if status != 200:
                    failures += 1
                first_calls.append(timings[0])
                later = timings[1:]
                all_calls.extend(later)
                print(
                    f"{place:<12} {label:<18} {status:<7} {ms(timings[0]):>9.0f} "
                    f"{ms(statistics.median(later)):>10.0f} {ms(max(later)):>8.0f}  {recommended}"
                )

    current_mb, peak_mb = memory_mb()
    print()
    print("Summary (calls after the first of each case)")
    print(f"  Typical request (median) : {ms(statistics.median(all_calls)):.0f} ms")
    print(f"  Slowest request          : {ms(max(all_calls)):.0f} ms")
    print(f"  Slowest first call       : {ms(max(first_calls)):.0f} ms")
    print(f"  Requests that failed     : {failures}")
    print(f"  Memory at end            : {current_mb:.0f} MB now, {peak_mb:.0f} MB peak")
    print()
    print("Nothing was downloaded, written or changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
