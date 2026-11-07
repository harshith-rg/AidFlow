# Phase 0 Report: Road-Network Feasibility Test

Area: central Bengaluru test box (west 77.56, south 12.96, east 77.62, north 13.00).

Tools: OSMnx 2.1.1, NetworkX (sample routes only; our own A* comes in Phase 3).

| Measurement | Result |
|---|---|
| Nodes | 6,828 |
| Directed edges | 16,972 |
| Graph file size | 6.47 MB |
| Download time | 92 s |
| Peak memory (download) | 326 MB |
| Peak memory (check) | 349 MB |
| Largest weak component | 99.3 % |
| Largest strong component | 98.4 % |
| H01 original coordinate to nearest road node | 162 m |
| H02 original coordinate to nearest road node | 8 m |

Sample routes (NetworkX, snapped road nodes, 30 km/h, no traffic):

| Route | Road km | Straight km | Ratio | ETA min |
|---|---|---|---|---|
| H01 -> H02 | 5.01 | 3.95 | 1.27 | 10.0 |
| H02 -> H01 | 4.53 | 3.95 | 1.15 | 9.1 |

Finding: one-way streets are real in the data (the two directions differ).

All hospital data is fictional DEMO data.

## Expanded Coverage Box Feasibility Report (Task 2 Decision)

Area: expanded Bengaluru coverage box (west 77.52, south 12.90, east 77.68, north 13.04).

| Measurement | Result |
|---|---|
| Hospitals inside coverage box | 23 / 37 |
| Hospital IDs inside | H01, H02, H03, H04, H05, H06, H07, H08, H09, H10, H11, H12, H13, H14, H15, H17, H20, H24, H25, H27, H29, H32, H34 |
| Raw Nodes | 72,040 |
| Raw Directed Edges | 187,803 |
| Cleaned Graph Nodes | 72,040 |
| Cleaned Graph Edges | 187,464 |
| Graph file size | 68.52 MB |
| Download and build time | 93.1 s |
| Save time | 18.2 s |
| Load time (graph_loader) | 20.12 s |
| Peak memory | 1,577.4 MB |
| Largest strong component | 71,483 nodes (99.2%) |
| Hospitals exceeding 500 m snap distance | None (0) |
| Hospitals in disconnected components | None (0) |

Snapping and Reachability Findings for 23 Hospitals:
- Maximum snapping distance: H01 at 162.1 m (well within 500 m threshold).
- Minimum snapping distance: H04 at 1.3 m.
- All 23 candidate hospitals snap to nodes within the largest strongly connected component (100% reachable).
- Conclusion: The chosen box provides sufficient candidate choice (23 hospitals) without disconnecting any facility.
