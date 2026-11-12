# Algorithm Decision Record: Routing & Hospital Recommendation Engine

**Project**: AidFlow — Smart Emergency Ambulance Routing & Hospital Recommendation
**Author**: Harshith RG (Member 3 — Routing & Ranking Module)
**Status**: Implemented & Verified (Provisional Proposals P1, P2, P10 Pending Whole-Team Approval)
**Contract Reference**: [`CONTRACT.md`](CONTRACT.md) v0.2

---

## 1. Executive Summary

This document records the architectural and algorithmic design decisions for the AidFlow emergency routing and hospital recommendation module. The primary responsibilities of this service are:
1. Snapping arbitrary GPS coordinates (patient pickup and hospital locations) to the nearest viable road network intersection node.
2. Calculating directed shortest paths across real-world urban road multigraphs accounting for one-way street constraints.
3. Estimating trip durations (ETAs) under assumed urban emergency driving speeds without dynamic traffic.
4. Filtering and multi-criteria ranking of eligible receiving hospitals to identify the optimal primary recommendation and ordered alternatives.

The table below summarizes the key architectural selections and their alternatives:

| Component | Selected Approach | Evaluated Alternatives | Key Trade-off / Decision Rationale |
|---|---|---|---|
| **Primary Routing Algorithm** | Custom **A\*** search with priority queue (`heapq`) | Custom Dijkstra, NetworkX `shortest_path`, Contraction Hierarchies (CH) | A\* provides goal-directed search towards the destination hospital, whereas Dijkstra settles nodes in non-decreasing accumulated path cost $g(u)$ without goal orientation; A\* is designed to prune node expansions oriented away from the goal without requiring CH preprocessing. |
| **Heuristic Function** | Scaled Great-Circle (**Haversine**) distance with safety factor $(1 - 10^{-6})$ | Euclidean distance, Manhattan distance, zero heuristic (Dijkstra) | Physical straight-line distance is admissible and consistent under the assumption of non-contractive surface edges; safety scale factor is intended to mitigate potential floating-point rounding discrepancies on short segments. |
| **Spatial Snapping** | **Pruned linear scan** with latitude lower-bound filter and lowest-ID tie-breaking | $k$-d tree, R-tree, brute-force unpruned scan | In `app/services/snapping.py`, implemented in pure Python with no third-party graph or spatial-indexing libraries (such as SciPy $k$-d trees or R-trees); the meridian latitude difference serves as a lower bound that skips non-promising nodes before Haversine calculation, with deterministic tie-breaking. |
| **Core Routing & Snapping Dependencies** | **Pure Python standard-library routing & snapping** (`heapq`, `dict`, `math`) | NetworkX at runtime, Graph-tool, SciPy spatial trees | Routing algorithms (`astar.py`, `dijkstra.py`) and spatial snapping (`snapping.py`) are implemented using Python standard-library data structures with no third-party graph or spatial-indexing libraries at runtime. NetworkX is retained strictly as an offline ground-truth test oracle. |
| **Hospital Ranking** | Multi-level deterministic tie-break with rounded ETA primary sort (provisional P2) | Unrounded float sorting (proposed P2), single-attribute greedy sort, Pareto frontier | Matches CONTRACT.md §8 literal definition (sorts on rounded `eta_min`); preserves deterministic outputs (P10) and stale-data safety (P1). Proposal to switch to unrounded sorting is pending team approval. |

---

## 2. Problem Formulation & Constraints

Emergency ambulance routing differs significantly from standard civilian navigation:
- **Asymmetric Directed Multigraphs**: Real-world urban street networks contain divided avenues, grade-separated flyovers, and one-way streets. A valid path from point $A$ to point $B$ does not imply that $B \to A$ is valid or has equivalent distance. In the Phase 0 benchmark, $H01 \to H02$ measured $5.01\text{ km}$ ($10.0\text{ min}$ ETA), whereas $H02 \to H01$ measured $4.53\text{ km}$ ($9.1\text{ min}$ ETA) due to central Bengaluru one-way circulatory systems.
- **Latency Budget**: Emergency dispatch cannot tolerate multi-second routing queries. Recommendation across multiple eligible hospitals must return within a single user-perceived interaction (< 1.5 seconds typical).
- **Offline / Isolated Execution**: The system must operate independently of external third-party routing APIs (e.g., Google Maps, Mapbox) to ensure determinism, zero licensing costs, and offline resilience during connectivity blackouts.
- **Contract Strictness**: The output schema, error envelopes, and rounding behavior are strictly bounded by `CONTRACT.md`.

---

## 3. Algorithm Selection: A* vs. Dijkstra

### 3.1 Mathematical Comparison

Given a directed weighted graph $G = (V, E)$ where each edge $(u, v) \in E$ has non-negative road length $w(u, v) \ge 0$:

1. **Dijkstra's Algorithm**:
   - Maintains a priority queue of unvisited nodes ordered by accumulated distance from origin $g(u)$.
   - Settles nodes in non-decreasing accumulated path cost from the origin until the destination target $t$ is settled.
   - Complexity: $O(|E| \log |V|)$ worst-case time using Python's binary min-heap (`heapq`) with lazy duplicate deletion. Because search priority depends solely on path cost from the start node $g(u)$, exploration is not directed toward the destination target.

2. **A\* Algorithm**:
   - Orders priority queue by evaluation function $f(u) = g(u) + h(u)$, where:
     - $g(u)$ is the exact accumulated road distance from start $s$ to node $u$.
     - $h(u)$ is a lower-bound estimate of the distance from node $u$ to destination target $t$.
   - Steers search exploration along an elliptical search cone oriented directly towards target $t$.
   - When $h(u) \equiv 0$, A\* degenerates gracefully into Dijkstra.

### 3.2 Heuristic Admissibility and Consistency

For A\* to return an optimal shortest path without needing to re-open closed nodes, standard heuristic conditions are:
- **Admissibility**: The heuristic must never overestimate the true remaining distance:
  $$\forall u \in V, \quad h(u) \le h^*(u)$$
- **Consistency (Monotonicity)**: For every edge $(u, v) \in E$:
  $$h(u) \le w(u, v) + h(v)$$

On the surface of the Earth, the shortest physical distance between two geographical points $(\phi_1, \lambda_1)$ and $(\phi_2, \lambda_2)$ is the great-circle geodesic, computed via the Haversine equation:
$$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)$$
$$d = 2 R \cdot \arcsin\left(\min(1.0, \sqrt{a})\right)$$
where $R = 6,371,000\text{ metres}$.

*Qualification on Admissibility*: Admissibility holds under the geometric model assumption that road segment weights $w(u, v)$ represent non-negative traversed surface path lengths on Earth, which cannot be shorter than the straight-line great-circle distance connecting their endpoints ($d_{hav}(u, v) \le w(u, v)$). Under this assumption, by the triangle inequality of spherical metric spaces:
$$d_{hav}(u, t) \le d_{hav}(u, v) + d_{hav}(v, t) \le w(u, v) + d_{hav}(v, t)$$
As a practical mitigation against potential floating-point rounding anomalies on very short segments, the graph loader scales the heuristic by $(1 - 10^{-6})$ (Section 3.3). This dampening does not constitute a formal proof of admissibility for arbitrary coordinate models, and strict mathematical admissibility relies on edge weights reflecting non-contractive geodesic surface lengths.

### 3.3 The Heuristic Safety Scale Factor $(1 - 10^{-6})$

In real-world computer systems, floating-point arithmetic (IEEE 754 float64) and geographic coordinate projections can introduce microscopic numerical inaccuracies. On very short road segments (e.g., $1.2\text{ metres}$ between divided lane nodes), rounding could theoretically cause $d_{hav}(u, v)$ to exceed $w(u, v)$ by a fraction of a millimetre, violating admissibility.

To eliminate this edge condition, the AidFlow graph loader (`app/services/graph_loader.py`) computes a safety scaling factor:
$$k_{safe} = 1.0 - 10^{-6} = 0.999999$$
Every heuristic evaluation applies this factor:
$$h(u) = k_{safe} \cdot D_{hav}(u, \text{target})$$
This dampens the heuristic by 1 millimetre per kilometre, intended as an empirical safeguard against minor floating-point rounding margins without perceptibly weakening search guidance; it is not a general mathematical guarantee across all coordinate systems.

---

## 4. Spatial Snapping & Road-Network Indexing

Ambulance dispatch locations and hospital entrances rarely lie exactly on road intersections. The snapping engine (`app/services/snapping.py`) maps coordinates to the nearest graph node:

- **Algorithm (`snap_to_road`)**: A deterministic **pruned linear scan** implemented in pure Python with no third-party graph or spatial-indexing libraries (no $k$-d tree, R-tree, or SciPy required).
  - **Latitude Lower-Bound Pruning**: For every node $i \in V$, the latitude distance along the meridian is checked first:
    $$\text{lat\_diff\_m} = |\phi_i - \phi_{\text{query}}| \times \frac{\pi R}{180}$$
    Because great-circle distance along any spherical path is strictly bounded below by meridian separation ($d_{\text{hav}} \ge \text{lat\_diff\_m}$), if $\text{lat\_diff\_m} \ge \text{best\_dist}$, the node is pruned immediately without invoking trigonometric functions.
  - **Haversine Distance**: For candidates passing the latitude pruning check, exact great-circle distance is evaluated via `haversine_m`.
  - **Deterministic Tie-Breaking**: If multiple nodes yield identical distance, the lower integer `node_id` is selected (`node_id < best_node`), ensuring identical outputs across runs.
- **Snapping Constraints**:
  - Coordinates outside the graph's coverage bounding box (`graph.coverage_box.contains(...)`) raise `OutOfCoverageError` (`OUT_OF_COVERAGE`, HTTP 422).
  - If `max_distance_m` is specified (e.g. 500 m) and the nearest road node exceeds that threshold, an `OutOfCoverageError` is raised.
- **Empirical Findings** (from Phase 0 and Phase 6 measurements):
  - Hospital H01 snap distance: $162.1\text{ m}$.
  - Hospital H04 snap distance: $1.3\text{ m}$.
  - Average snap distance across the 23 active hospitals: $42.6\text{ m}$.
  - All 23 candidate hospitals snap to nodes within the largest strongly connected component (100% reachable).

---

## 5. Hospital Filtering, ETA, and Ranking Tie-Breaks

### 5.1 Eligibility Filtering Pipeline (`app/services/hospital_filter.py`)

1. **Operational Status**: Hospital must have `is_operational == True`.
2. **Specialty Matching**: Hospital `specialties` set must be a superset of all requested `needs`.
3. **Data Freshness Classification**:
   - Evaluated against reference clock (`clock.get_reference_time()`).
   - If `(reference_time - updated_at) > 3600 seconds` (1 hour), the hospital's bed count is classified as **stale** (`bed_data_stale = True`).
   - In `AIDFLOW_TIME_MODE=real`, demo dataset records (dated 2026-10-31) are marked stale, bed counts are ignored, and the response carries the `STALE_HOSPITAL_DATA` warning.
   - In `AIDFLOW_TIME_MODE=demo`, reference time freezes to the dataset's `as_of` timestamp.

### 5.2 Distance & ETA Calculation (`app/services/distance_eta.py`)

- **Formula** (CONTRACT.md §9):
  $$\text{eta\_min} = \left(\frac{\text{road\_distance\_km}}{\text{average\_speed\_kmh}}\right) \times 60$$
- **Velocity**: Constant urban emergency speed, default $30\text{ km/h}$ (`Settings.average_speed_kmh`).
- **Rounding Semantics** (Decisions D1 & D2):
  - Road distance is calculated in exact metres from graph edge weights.
  - $\text{distance\_km}$ is rounded half-up to 2 decimal places.
  - $\text{eta\_min}$ is calculated directly from the unrounded distance and rounded half-up once to 1 decimal place using Python `Decimal` to avoid cumulative floating-point errors.
  - The unrounded value is retained internally in `raw_eta_min` to facilitate proposal P2 evaluation.

### 5.3 Deterministic Ranking Hierarchy (`app/services/hospital_ranking.py`)

To ensure identical inputs always yield identical outputs (CONTRACT.md §8 step 5), hospitals are sorted using the following tiered key:

```python
def _sort_key(candidate: RankingCandidate, basis: EtaBasis) -> tuple:
    eta = _eta_for_sorting(candidate, basis)
    if candidate.bed_data_stale:
        group, beds_key = 1, 0
    else:
        group, beds_key = 0, -candidate.beds_available  # more beds sorts first
    return (
        eta,
        group,
        beds_key,
        candidate.name.casefold(),
        candidate.name,
        candidate.hospital_id,
    )
```

#### Status of Provisional Ranking Proposals:
- **P1 (Pending Team Approval)**: Stale data tie-break group rule. ETA takes absolute precedence (a stale hospital with a 5-minute ETA beats a fresh hospital with a 15-minute ETA). Only among hospitals tied on ETA does freshness break the tie (fresh `group=0` before stale `group=1`). Stale hospital bed counts are replaced by 0.
- **P2 (Pending Team Approval)**: CONTRACT.md §8 literally states "sort by `eta_min`" (the rounded display value). The implementation defaults to `DEFAULT_ETA_BASIS = EtaBasis.ROUNDED`, sorting by the 1-decimal rounded `eta_min`. Proposal P2 proposes ranking on unrounded ETA (`raw_eta_min`), but that proposal remains **pending whole-team approval**. The unrounded ETA is preserved internally in `RankingCandidate.raw_eta_min` so that switching to unrounded ranking requires only flipping the default enum to `EtaBasis.UNROUNDED` if the team approves it.
- **P10 (Pending Team Approval)**: Uses `hospital_id` as the final deterministic tie-break to prevent arbitrary sort reordering.

---

## 6. Empirical Performance Measurements & Benchmarks

The figures below represent empirical measurements recorded during development using reproducible scripts and server logs on an Intel i7 Windows environment:

### 6.1 Graph Comparison (Sources: `docs/PHASE0_REPORT.md` and `scripts/measure_coverage_box.py`)

- **Method**: Evaluated by downloading and building OSMnx road networks for the specified bounding boxes, followed by component analysis using NetworkX.

| Metric | Central Bengaluru Initial Box (Phase 0) | Expanded Coverage Box (Active Graph) |
|---|---|---|
| **Measurement Script / Source** | `phase0/` test run (`docs/PHASE0_REPORT.md`) | `scripts/measure_coverage_box.py` |
| **GraphML File** | `bengaluru_small_full.graphml` | `bengaluru_coverage_box.graphml` |
| **File Size** | 6.47 MB | 68.52 MB |
| **Nodes** | 6,828 | 72,040 |
| **Directed Edges** | 16,972 | 187,464 |
| **Covered Hospitals** | 2 of 37 demo hospitals | 23 of 37 demo hospitals |
| **Largest Strongly Connected Component** | 98.4% | 99.2% (71,483 nodes) |

### 6.2 Latency and Memory Profile

#### Isolated Graph-Load Timings
- **Sources**: `phase0/output/coverage_box_report.json` and `scripts/measure_recommend.py`.
- **Method**: In-process execution of `load_road_graph()` parsing the 68.52 MB GraphML XML file into memory:
  - **20.12 s**: Measured in `scripts/measure_coverage_box.py` loading `bengaluru_coverage_box.graphml` (recorded in `phase0/output/coverage_box_report.json:41`).
  - **26.79 s**: In-process graph load time measured during the offline benchmark run `python scripts/measure_recommend.py --graph <graph_file>`.
  - **Peak Resident Memory**: **1,577.4 MB** (~1.58 GB RAM) measured via `psutil.Process().memory_info().peak_wset` in `scripts/measure_coverage_box.py` (`coverage_box_report.json:42`), and **1,362 MB** during test runs.

#### Server-Startup Lifespan Preload Timings
- **Source**: FastAPI lifespan startup logs (`app/main.py::lifespan`).
- **Method**: Elapsed time measured with `time.perf_counter()` around `get_road_graph()` during server initialization:
  - **23.14 s**: Lifespan startup preload recorded during Phase 6 timing run on warm filesystem cache.
  - **78.24 s**: Lifespan startup preload recorded in live Uvicorn server task log (`app/main.py:42-50`) under cold filesystem cache (`INFO: app.main: Road graph loaded in 78.24s (72040 nodes, 187464 edges)`).

#### Request-Time Routing Latency
- **Source**: `scripts/measure_recommend.py`.
- **Method**: Evaluated using FastAPI `TestClient` across 15 requests (5 pickup points $\times$ 3 specialty sets) with preloaded graph under demo clock:
  - **Median**: **611 ms**, range **276 ms to 1,022 ms** on preloaded startup run.
  - **Distribution**: Typical **1.4 s**, maximum **4.0 s**, **0 failures** across cold/warm test iterations.

#### Algorithmic Search Characteristics (A\* vs. Dijkstra)
- **Dijkstra's Algorithm**: Settles unvisited nodes in non-decreasing accumulated path cost $g(u)$ from the origin.
- **A\* Algorithm**: Incorporates the goal-directed Haversine heuristic $h(u)$ into the priority $f(u) = g(u) + h(u)$ to orient exploration toward the target hospital, designed to limit node expansions in directions away from the goal.

---

## 7. Quality Assurance & Ground-Truth Verification

The custom A\* and Dijkstra engines are verified against NetworkX using property-based agreement testing (`tests/test_routing_agreement.py`):
1. **Deterministic Synthetic Graphs**: Grids, directed rings, parallel paths, and asymmetric weights.
2. **Empirical Real-Map Agreement**: 100 randomly sampled origin-destination pairs on the active Bengaluru road network.
3. **Verification Criterion**:
   - `route_astar.total_distance_m == route_dijkstra.total_distance_m == nx.shortest_path_length(...)`
   - Every returned road distance and edge sequence is identical within floating-point tolerance ($< 10^{-3}\text{ m}$).
