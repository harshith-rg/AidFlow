\# Phase 0 Report: small road-network feasibility test



Area: central Bengaluru test box (west 77.56, south 12.96, east 77.62, north 13.00).

Tools: OSMnx 2.1.1, NetworkX (sample routes only; our own A\* comes in Phase 3).



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



Not yet measured: the full Bengaluru coverage box (about 45 times larger).

All hospital data is fictional DEMO data.

