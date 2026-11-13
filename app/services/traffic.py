"""Simulated traffic engine for emergency routing demos.

This module provides non-mutating traffic scenario overlays that assign travel-time
weights and road closures to edges without modifying the underlying RoadGraph.

Design Rules (Engineering Requirements):
  1. Distance and travel time are kept separate:
     - Physical road distance (metres/km) is strictly preserved.
     - Travel-time costs represent per-segment congestion delays relative to
       the assumed base emergency speed.
  2. Deterministic demo inputs:
     - Scenarios are defined with fixed, reproducible multipliers on designated
       central corridors or specific closures.
     - All outputs are labeled as illustrative demo simulations, not live traffic.
  3. Non-mutating graph overlay:
     - The loaded RoadGraph remains 100% immutable (MappingProxyType untouched).
     - Overlays compute dynamic edge costs and closure checks at query time.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

from app.services.geo import GeoBox

if TYPE_CHECKING:
    from app.services.road_graph import Edge, RoadGraph


class TrafficScenarioId(StrEnum):
    """Supported simulated traffic scenario identifiers."""

    NORMAL = "normal"
    MODERATE = "moderate"
    HEAVY = "heavy"
    CLOSURE = "closure"


@dataclass(frozen=True)
class TrafficScenarioInfo:
    """Public metadata describing a traffic scenario for UI and API clients."""

    scenario_id: str
    name: str
    description: str
    corridor_factor: float
    non_corridor_factor: float
    has_closure: bool
    closed_edges_count: int
    disclaimer: str


# Bounding box covering central Bengaluru commercial corridor (Majestic, MG Road, Vidhana Soudha)
# South: 12.960, North: 12.990, West: 77.570, East: 77.620
CENTRAL_BENGALURU_CORRIDOR = GeoBox(
    south=12.960,
    north=12.990,
    west=77.570,
    east=77.620,
)

# Default closure directed edge on the central Bengaluru road graph:
# Connects node 286964496 to node 428831267 (key arterial connection near Majestic / Cubbon Park).
DEFAULT_BENGALURU_CLOSED_EDGE: tuple[int, int] = (286964496, 428831267)

DISCLAIMER_TEXT = (
    "SIMULATED TRAFFIC DEMO — Illustrative demo values for academic presentation; "
    "not measured, predicted, or live traffic."
)


@dataclass(frozen=True)
class TrafficOverlay:
    """Non-mutating scenario overlay applied to a RoadGraph during path search.

    Attributes:
        scenario_id: Scenario identifier string.
        name: Human-readable scenario name.
        description: Explanatory summary.
        corridor_factor: Travel-time multiplier on segments in the designated corridor (>= 1.0).
        non_corridor_factor: Travel-time multiplier on other segments (>= 1.0).
        corridor_box: Optional bounding box identifying congested corridor segments.
        closed_edges: Frozenset of directed (source_node_id, target_node_id) tuples that cannot be traversed.
        disclaimer: Honesty label.
    """

    scenario_id: str
    name: str
    description: str
    corridor_factor: float = 1.0
    non_corridor_factor: float = 1.0
    corridor_box: GeoBox | None = None
    closed_edges: frozenset[tuple[int, int]] = frozenset()
    disclaimer: str = DISCLAIMER_TEXT

    def __post_init__(self) -> None:
        if self.corridor_factor < 1.0 or self.non_corridor_factor < 1.0:
            raise ValueError("Congestion factors must be >= 1.0 (cannot travel faster than speed limit).")

    def is_edge_closed(self, edge: Edge) -> bool:
        """Check whether a directed road segment is blocked under this scenario."""
        return (edge.source, edge.target) in self.closed_edges

    def edge_weight_factor(self, edge: Edge, graph: RoadGraph) -> float:
        """Return the travel-time multiplier for an edge (1.0 = normal, > 1.0 = delayed, inf = closed)."""
        if self.is_edge_closed(edge):
            return float("inf")

        if self.corridor_box is not None and self.corridor_factor > self.non_corridor_factor:
            src_lat, src_lng = graph.coords(edge.source)
            tgt_lat, tgt_lng = graph.coords(edge.target)
            if self.corridor_box.contains(src_lat, src_lng) or self.corridor_box.contains(tgt_lat, tgt_lng):
                return self.corridor_factor

        return self.non_corridor_factor

    def edge_effective_cost_m(self, edge: Edge, graph: RoadGraph) -> float:
        """Calculate effective travel-time distance cost for search (metres * multiplier)."""
        factor = self.edge_weight_factor(edge, graph)
        if not math.isfinite(factor):
            return float("inf")
        return edge.length_m * factor

    def to_info(self) -> TrafficScenarioInfo:
        """Export public metadata summary."""
        return TrafficScenarioInfo(
            scenario_id=self.scenario_id,
            name=self.name,
            description=self.description,
            corridor_factor=self.corridor_factor,
            non_corridor_factor=self.non_corridor_factor,
            has_closure=bool(self.closed_edges),
            closed_edges_count=len(self.closed_edges),
            disclaimer=self.disclaimer,
        )


def get_traffic_overlay(
    scenario_id: str | None,
    custom_closed_edges: list[tuple[int, int]] | None = None,
    corridor_box: GeoBox | None = CENTRAL_BENGALURU_CORRIDOR,
) -> TrafficOverlay:
    """Construct a TrafficOverlay for a given scenario ID.

    Supported scenarios:
      - 'normal': Baseline travel at uniform speed, 0 closures, multiplier = 1.0.
      - 'moderate': Moderate congestion (+60% travel time in central corridor, +20% elsewhere).
      - 'heavy': Heavy congestion (+150% travel time in central corridor, +50% elsewhere).
      - 'closure': Demonstrable road closure on a key corridor segment, forcing detour routing.

    Raises:
        ValueError: If scenario_id is unrecognized.
    """
    raw_id = (scenario_id or "normal").strip().lower()

    extra_closures = set(custom_closed_edges or [])

    if raw_id in ("normal", "none", "baseline"):
        return TrafficOverlay(
            scenario_id="normal",
            name="Normal (No congestion)",
            description="Baseline routing at assumed uniform emergency speed (30 km/h).",
            corridor_factor=1.0,
            non_corridor_factor=1.0,
            corridor_box=None,
            closed_edges=frozenset(extra_closures),
        )

    if raw_id == "moderate":
        return TrafficOverlay(
            scenario_id="moderate",
            name="Moderate congestion",
            description="Simulated arterial delays: +60% travel time in central corridor, +20% elsewhere.",
            corridor_factor=1.6,
            non_corridor_factor=1.2,
            corridor_box=corridor_box,
            closed_edges=frozenset(extra_closures),
        )

    if raw_id == "heavy":
        return TrafficOverlay(
            scenario_id="heavy",
            name="Heavy congestion",
            description="Simulated gridlock: +150% travel time in central corridor, +50% elsewhere.",
            corridor_factor=2.5,
            non_corridor_factor=1.5,
            corridor_box=corridor_box,
            closed_edges=frozenset(extra_closures),
        )

    if raw_id == "closure":
        closure_set = set(extra_closures)
        if not closure_set:
            closure_set.add(DEFAULT_BENGALURU_CLOSED_EDGE)
        return TrafficOverlay(
            scenario_id="closure",
            name="Road closure scenario",
            description="Simulated road blockage on key corridor link forcing detour routing.",
            corridor_factor=1.0,
            non_corridor_factor=1.0,
            corridor_box=None,
            closed_edges=frozenset(closure_set),
        )

    raise ValueError(
        f"Unknown traffic scenario '{scenario_id}'. "
        f"Supported scenarios: {[s.value for s in TrafficScenarioId]}."
    )


def list_available_scenarios() -> list[TrafficScenarioInfo]:
    """Return public metadata for all built-in scenarios."""
    return [
        get_traffic_overlay("normal").to_info(),
        get_traffic_overlay("moderate").to_info(),
        get_traffic_overlay("heavy").to_info(),
        get_traffic_overlay("closure").to_info(),
    ]
