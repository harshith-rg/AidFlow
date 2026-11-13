"""URL routes of the service.

Phase 1 has GET /health.
Phase 3 adds an interactive Leaflet map interface at GET / and demo routing APIs.
Phase 5 implements POST /recommend-hospital (CONTRACT.md sections 3-5).
"""

import logging
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.errors import AidFlowError
from app.core.config import Settings, load_settings
from app.data.hospital_repository import load_repository
from app.models.hospital import Hospital
from app.models.schemas import (
    AlternativeHospital,
    AssumptionsDetail,
    ErrorCode,
    HealthResponse,
    HospitalLocation,
    RecommendHospitalRequest,
    RecommendHospitalResponse,
    RecommendedHospital,
    RouteDetail,
    SimulatedHospitalItem,
    SimulatedRecommendRequest,
    SimulatedRecommendResponse,
    SimulatedRouteDetail,
    TrafficScenariosResponse,
    TrafficScenarioSummary,
    WarningCode,
    WarningDetail,
)
from app.services.traffic import (
    DISCLAIMER_TEXT,
    get_traffic_overlay,
    list_available_scenarios,
)
from app.services.clock import get_reference_time
from app.services.distance_eta import DistanceEta, calculate_distance_eta
from app.services.geo import CoordinateError, validate_lat_lng
from app.services.graph_loader import GraphError, get_road_graph
from app.services.hospital_filter import filter_hospitals
from app.services.hospital_ranking import (
    DEFAULT_ETA_BASIS,
    RankingCandidate,
    rank_hospitals,
)
from app.services.reasons import build_reasons
from app.services.routing import PathNotFoundError, RouteResult, find_route
from app.services.snapping import OutOfCoverageError, snap_hospital, snap_to_road

logger = logging.getLogger("aidflow.api")
router = APIRouter()

ALLOWED_NEEDS = frozenset({
    "ICU",
    "TRAUMA",
    "CARDIAC",
    "NEURO",
    "MATERNITY",
    "PAEDIATRIC",
    "GENERAL",
})


@router.get("/health", response_model=HealthResponse, summary="Is the service running?")
def health() -> HealthResponse:
    """CONTRACT.md section 3: returns exactly {"status": "ok"}."""
    return HealthResponse(status="ok")


# ---------------------------------------------------------------------------
# Phase 5: Recommendation Endpoint (CONTRACT.md Section 3-5)
# ---------------------------------------------------------------------------
@router.post(
    "/recommend-hospital",
    response_model=RecommendHospitalResponse,
    summary="Recommend optimal hospital for emergency",
)
def recommend_hospital(
    req: RecommendHospitalRequest,
    request: Request,
) -> RecommendHospitalResponse:
    """Recommend the optimal hospital and alternatives for an emergency.

    Implements CONTRACT.md section 3-5 with all validations, ranking rules,
    and contract-compliant error handling.
    """
    # 1. Validate coordinates range
    try:
        validate_lat_lng(req.origin.lat, req.origin.lng)
    except CoordinateError as err:
        raise AidFlowError(
            ErrorCode.INVALID_COORDINATES,
            str(err),
            400,
            {"origin": {"lat": req.origin.lat, "lng": req.origin.lng}},
        ) from err

    # 2. Validate needs vocabulary
    for need in req.needs:
        if need not in ALLOWED_NEEDS:
            raise AidFlowError(
                ErrorCode.INVALID_REQUEST,
                f"Unknown need '{need}'. Allowed needs: {sorted(ALLOWED_NEEDS)}.",
                400,
                {"needs": req.needs, "unknown_need": need},
            )

    # 3. Validate max_alternatives
    max_alt = 2 if req.max_alternatives is None else req.max_alternatives
    if isinstance(max_alt, bool) or not isinstance(max_alt, int) or max_alt < 0 or max_alt > 5:
        raise AidFlowError(
            ErrorCode.INVALID_REQUEST,
            f"max_alternatives must be an integer between 0 and 5, but got {max_alt}.",
            400,
            {"max_alternatives": max_alt},
        )

    # 4. Candidate hospitals and repository validation (before graph loading)
    repo = load_repository()
    if req.candidate_hospital_ids is not None:
        if len(req.candidate_hospital_ids) == 0:
            raise AidFlowError(
                ErrorCode.NO_ELIGIBLE_HOSPITAL,
                "Candidate hospital list is empty.",
                422,
                {"candidate_hospital_ids": []},
            )
        for hid in req.candidate_hospital_ids:
            if not isinstance(hid, str) or repo.get(hid) is None:
                raise AidFlowError(
                    ErrorCode.INVALID_REQUEST,
                    f"Unknown candidate hospital ID '{hid}'.",
                    400,
                    {
                        "candidate_hospital_ids": req.candidate_hospital_ids,
                        "unknown_id": hid,
                    },
                )
        seen_ids: set[str] = set()
        candidate_hospitals: list[Hospital] = []
        for hid in req.candidate_hospital_ids:
            if hid not in seen_ids:
                seen_ids.add(hid)
                candidate_hospitals.append(repo.get(hid))  # type: ignore[arg-type]
    else:
        candidate_hospitals = list(repo.all())

    # 5. Load Road Graph
    try:
        graph = get_road_graph()
    except GraphError as err:
        logger.error("Failed to load road graph: %s", err)
        raise AidFlowError(
            ErrorCode.INTERNAL_ERROR,
            "Road graph file not found. Run: python scripts/setup_graph.py",
            500,
            {},
        ) from err

    # 6. Snap origin to road
    try:
        snap_origin = snap_to_road(graph, req.origin.lat, req.origin.lng)
    except OutOfCoverageError as err:
        raise AidFlowError(
            ErrorCode.OUT_OF_COVERAGE,
            str(err),
            422,
            {"origin": {"lat": req.origin.lat, "lng": req.origin.lng}},
        ) from err

    # 7. Filter hospitals
    settings: Settings = getattr(request.app.state, "settings", None) or load_settings()
    reference = get_reference_time(settings, repo.meta.as_of)
    filtered = filter_hospitals(
        candidate_hospitals,
        req.needs,
        reference.value,
        settings.stale_after_minutes,
    )

    if len(filtered.eligible) == 0:
        needs_str = f" with {', '.join(req.needs)}" if req.needs else ""
        raise AidFlowError(
            ErrorCode.NO_ELIGIBLE_HOSPITAL,
            f"No open hospital{needs_str} found among {len(candidate_hospitals)} candidates.",
            422,
            {"needs": req.needs, "candidate_count": len(candidate_hospitals)},
        )

    # 8. Route to eligible hospitals
    ranking_candidates: list[RankingCandidate] = []
    routes_by_id: dict[str, tuple[RouteResult, DistanceEta, Hospital]] = {}

    for eligible_item in filtered.eligible:
        hospital = eligible_item.hospital
        try:
            snap_hosp = snap_hospital(graph, hospital)
        except OutOfCoverageError:
            logger.debug(
                "Hospital %s at (%s, %s) is outside road network coverage; skipping.",
                hospital.hospital_id,
                hospital.location.lat,
                hospital.location.lng,
            )
            continue

        try:
            route = find_route(
                graph,
                snap_origin.node_id,
                snap_hosp.node_id,
                algorithm="astar",
            )
        except PathNotFoundError:
            logger.debug(
                "No road path from origin node %s to hospital %s node %s.",
                snap_origin.node_id,
                hospital.hospital_id,
                snap_hosp.node_id,
            )
            continue

        dist_eta = calculate_distance_eta(
            route.total_distance_m, settings.average_speed_kmh
        )
        ranking_candidates.append(
            RankingCandidate(
                hospital_id=hospital.hospital_id,
                name=hospital.name,
                beds_available=hospital.beds_available,
                eta_min=dist_eta.eta_min,
                bed_data_stale=eligible_item.bed_data_stale,
                raw_eta_min=dist_eta.raw_eta_min,
            )
        )
        routes_by_id[hospital.hospital_id] = (route, dist_eta, hospital)

    if not ranking_candidates:
        raise AidFlowError(
            ErrorCode.NO_ROUTE_FOUND,
            "No road path found from origin to any eligible hospital.",
            422,
            {"eligible_hospital_ids": list(filtered.eligible_ids)},
        )

    # 9. Rank hospitals and generate reasons
    ranked = rank_hospitals(ranking_candidates, eta_basis=DEFAULT_ETA_BASIS)
    reasons = build_reasons(req.needs, ranked)

    best_ranked = ranked[0]
    best_reason = reasons[0]
    best_route, best_dist_eta, best_hosp = routes_by_id[best_ranked.hospital_id]

    recommended = RecommendedHospital(
        hospital_id=best_ranked.hospital_id,
        name=best_ranked.candidate.name,
        location=HospitalLocation(
            lat=best_hosp.location.lat,
            lng=best_hosp.location.lng,
        ),
        distance_km=best_dist_eta.distance_km,
        eta_min=best_dist_eta.eta_min,
        reason=best_reason,
        bed_data_stale=best_ranked.candidate.bed_data_stale,
    )

    alt_ranked_list = ranked[1 : 1 + max_alt]
    alt_reasons_list = reasons[1 : 1 + max_alt]

    alternatives: list[AlternativeHospital] = []
    for alt_ranked, alt_reason in zip(alt_ranked_list, alt_reasons_list, strict=True):
        _, alt_dist_eta, _ = routes_by_id[alt_ranked.hospital_id]
        alternatives.append(
            AlternativeHospital(
                hospital_id=alt_ranked.hospital_id,
                name=alt_ranked.candidate.name,
                distance_km=alt_dist_eta.distance_km,
                eta_min=alt_dist_eta.eta_min,
                reason=alt_reason,
                bed_data_stale=alt_ranked.candidate.bed_data_stale,
            )
        )

    route_detail = RouteDetail(
        to_hospital_id=best_ranked.hospital_id,
        distance_km=best_dist_eta.distance_km,
        eta_min=best_dist_eta.eta_min,
        polyline=[list(pt) for pt in best_route.polyline],
    )

    warnings: list[WarningDetail] = []
    if best_ranked.candidate.bed_data_stale or any(
        a.candidate.bed_data_stale for a in alt_ranked_list
    ):
        warnings.append(
            WarningDetail(
                code=WarningCode.STALE_HOSPITAL_DATA,
                message=f"Hospital bed counts may be outdated (older than {int(settings.stale_after_minutes)} minutes).",
            )
        )

    speed_val = (
        int(settings.average_speed_kmh)
        if settings.average_speed_kmh.is_integer()
        else settings.average_speed_kmh
    )

    assumptions = AssumptionsDetail(
        eta_method="road distance / assumed average speed",
        average_speed_kmh=speed_val,
        live_traffic=False,
        routing_algorithm="astar",
        hospital_data="DEMO values, not real",
    )

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return RecommendHospitalResponse(
        case_id=req.case_id,
        recommended=recommended,
        alternatives=alternatives,
        route=route_detail,
        warnings=warnings,
        assumptions=assumptions,
        generated_at=generated_at,
    )



# ---------------------------------------------------------------------------
# Phase 3 Interactive Live Map Demo & Phase 9 Simulated Traffic Demo
# ---------------------------------------------------------------------------
class DemoRouteRequest(BaseModel):
    origin_lat: float
    origin_lng: float
    hospital_id: str
    algorithm: str = "astar"
    scenario: str = "normal"


@router.get(
    "/api/demo/traffic-scenarios",
    response_model=TrafficScenariosResponse,
    summary="List available simulated traffic scenarios",
)
def demo_traffic_scenarios() -> TrafficScenariosResponse:
    """Return all available deterministic demo scenarios with descriptions and multipliers."""
    scenarios = list_available_scenarios()
    return TrafficScenariosResponse(
        scenarios=[TrafficScenarioSummary(**s.__dict__) for s in scenarios],
        disclaimer=DISCLAIMER_TEXT,
    )


@router.post(
    "/api/demo/recommend-simulated",
    response_model=SimulatedRecommendResponse,
    summary="Recommend hospital under simulated traffic conditions",
)
def demo_recommend_simulated(
    req: SimulatedRecommendRequest,
    request: Request,
) -> SimulatedRecommendResponse:
    """Recommend optimal hospital and alternatives under simulated traffic conditions.

    Demonstrates moderate and heavy congestion multipliers on central corridors,
    as well as road closures forcing detour routing. Physical road distance
    is strictly preserved while travel times (ETAs) and rankings reflect the simulation.
    """
    # 1. Validate coordinates range
    try:
        validate_lat_lng(req.origin.lat, req.origin.lng)
    except CoordinateError as err:
        raise AidFlowError(
            ErrorCode.INVALID_COORDINATES,
            str(err),
            400,
            {"origin": {"lat": req.origin.lat, "lng": req.origin.lng}},
        ) from err

    # 2. Validate needs vocabulary
    for need in req.needs:
        if need not in ALLOWED_NEEDS:
            raise AidFlowError(
                ErrorCode.INVALID_REQUEST,
                f"Unknown need '{need}'. Allowed needs: {sorted(ALLOWED_NEEDS)}.",
                400,
                {"needs": req.needs, "unknown_need": need},
            )

    # 3. Validate max_alternatives
    max_alt = 2 if req.max_alternatives is None else req.max_alternatives
    if isinstance(max_alt, bool) or not isinstance(max_alt, int) or max_alt < 0 or max_alt > 5:
        raise AidFlowError(
            ErrorCode.INVALID_REQUEST,
            f"max_alternatives must be an integer between 0 and 5, but got {max_alt}.",
            400,
            {"max_alternatives": max_alt},
        )

    # 4. Validate routing algorithm
    algo = req.algorithm.lower().strip()
    if algo not in ("astar", "dijkstra"):
        raise AidFlowError(
            ErrorCode.INVALID_REQUEST,
            f"Unknown routing algorithm '{req.algorithm}'. Supported: 'astar', 'dijkstra'.",
            400,
            {"algorithm": req.algorithm},
        )

    # 5. Build traffic scenario overlay
    custom_closures: list[tuple[int, int]] | None = None
    if req.custom_closed_edges:
        custom_closures = [tuple(pair) for pair in req.custom_closed_edges]  # type: ignore[misc]

    try:
        overlay = get_traffic_overlay(req.scenario, custom_closed_edges=custom_closures)
    except ValueError as err:
        raise AidFlowError(
            ErrorCode.INVALID_REQUEST,
            str(err),
            400,
            {"scenario": req.scenario},
        ) from err

    # 6. Candidate hospitals and repository validation (before graph loading)
    repo = load_repository()
    if req.candidate_hospital_ids is not None:
        if len(req.candidate_hospital_ids) == 0:
            raise AidFlowError(
                ErrorCode.NO_ELIGIBLE_HOSPITAL,
                "Candidate hospital list is empty.",
                422,
                {"candidate_hospital_ids": []},
            )
        for hid in req.candidate_hospital_ids:
            if not isinstance(hid, str) or repo.get(hid) is None:
                raise AidFlowError(
                    ErrorCode.INVALID_REQUEST,
                    f"Unknown candidate hospital ID '{hid}'.",
                    400,
                    {
                        "candidate_hospital_ids": req.candidate_hospital_ids,
                        "unknown_id": hid,
                    },
                )
        seen_ids: set[str] = set()
        candidate_hospitals: list[Hospital] = []
        for hid in req.candidate_hospital_ids:
            if hid not in seen_ids:
                seen_ids.add(hid)
                candidate_hospitals.append(repo.get(hid))  # type: ignore[arg-type]
    else:
        candidate_hospitals = list(repo.all())

    # 7. Load Road Graph
    try:
        graph = get_road_graph()
    except GraphError as err:
        logger.error("Failed to load road graph: %s", err)
        raise AidFlowError(
            ErrorCode.INTERNAL_ERROR,
            "Road graph file not found. Run: python scripts/setup_graph.py",
            500,
            {},
        ) from err

    # 8. Snap origin to road
    try:
        snap_origin = snap_to_road(graph, req.origin.lat, req.origin.lng)
    except OutOfCoverageError as err:
        raise AidFlowError(
            ErrorCode.OUT_OF_COVERAGE,
            str(err),
            422,
            {"origin": {"lat": req.origin.lat, "lng": req.origin.lng}},
        ) from err

    # 9. Filter hospitals
    settings: Settings = getattr(request.app.state, "settings", None) or load_settings()
    reference = get_reference_time(settings, repo.meta.as_of)
    filtered = filter_hospitals(
        candidate_hospitals,
        req.needs,
        reference.value,
        settings.stale_after_minutes,
    )

    if len(filtered.eligible) == 0:
        needs_str = f" with {', '.join(req.needs)}" if req.needs else ""
        raise AidFlowError(
            ErrorCode.NO_ELIGIBLE_HOSPITAL,
            f"No open hospital{needs_str} found among {len(candidate_hospitals)} candidates.",
            422,
            {"needs": req.needs, "candidate_count": len(candidate_hospitals)},
        )

    # 10. Route to eligible hospitals under simulated overlay
    ranking_candidates: list[RankingCandidate] = []
    routes_by_id: dict[
        str,
        tuple[RouteResult, DistanceEta, DistanceEta, float, Hospital],
    ] = {}

    for eligible_item in filtered.eligible:
        hospital = eligible_item.hospital
        try:
            snap_hosp = snap_hospital(graph, hospital)
        except OutOfCoverageError:
            continue

        try:
            route = find_route(
                graph,
                snap_origin.node_id,
                snap_hosp.node_id,
                algorithm=algo,
                overlay=overlay,
            )
        except PathNotFoundError:
            continue

        phys_dist_m = route.total_distance_m
        eff_cost_m = (
            route.effective_cost_m
            if route.effective_cost_m is not None
            else phys_dist_m
        )

        base_dist_eta = calculate_distance_eta(phys_dist_m, settings.average_speed_kmh)
        sim_dist_eta = calculate_distance_eta(eff_cost_m, settings.average_speed_kmh)
        delay_min = round(max(0.0, sim_dist_eta.eta_min - base_dist_eta.eta_min), 1)

        ranking_candidates.append(
            RankingCandidate(
                hospital_id=hospital.hospital_id,
                name=hospital.name,
                beds_available=hospital.beds_available,
                eta_min=sim_dist_eta.eta_min,  # Rank using SIMULATED travel time!
                bed_data_stale=eligible_item.bed_data_stale,
                raw_eta_min=sim_dist_eta.raw_eta_min,
            )
        )
        routes_by_id[hospital.hospital_id] = (
            route,
            base_dist_eta,
            sim_dist_eta,
            delay_min,
            hospital,
        )

    if not ranking_candidates:
        raise AidFlowError(
            ErrorCode.NO_ROUTE_FOUND,
            f"No road path found from origin to any eligible hospital under scenario '{overlay.scenario_id}'.",
            422,
            {"eligible_hospital_ids": list(filtered.eligible_ids), "scenario": overlay.scenario_id},
        )

    # 11. Rank hospitals by simulated ETA and generate reason sentences
    ranked = rank_hospitals(ranking_candidates, eta_basis=DEFAULT_ETA_BASIS)
    reasons = build_reasons(req.needs, ranked)

    best_ranked = ranked[0]
    best_reason = reasons[0]
    (
        best_route,
        best_base_eta,
        best_sim_eta,
        best_delay,
        best_hosp,
    ) = routes_by_id[best_ranked.hospital_id]

    recommended = SimulatedHospitalItem(
        hospital_id=best_ranked.hospital_id,
        name=best_ranked.candidate.name,
        location=HospitalLocation(
            lat=best_hosp.location.lat,
            lng=best_hosp.location.lng,
        ),
        distance_km=best_base_eta.distance_km,  # Preserves physical distance
        baseline_eta_min=best_base_eta.eta_min,
        simulated_eta_min=best_sim_eta.eta_min,
        delay_min=best_delay,
        reason=best_reason,
        bed_data_stale=best_ranked.candidate.bed_data_stale,
    )

    alt_ranked_list = ranked[1 : 1 + max_alt]
    alt_reasons_list = reasons[1 : 1 + max_alt]

    alternatives: list[SimulatedHospitalItem] = []
    for alt_ranked, alt_reason in zip(alt_ranked_list, alt_reasons_list, strict=True):
        _, alt_base_eta, alt_sim_eta, alt_delay, _ = routes_by_id[alt_ranked.hospital_id]
        alternatives.append(
            SimulatedHospitalItem(
                hospital_id=alt_ranked.hospital_id,
                name=alt_ranked.candidate.name,
                distance_km=alt_base_eta.distance_km,  # Preserves physical distance
                baseline_eta_min=alt_base_eta.eta_min,
                simulated_eta_min=alt_sim_eta.eta_min,
                delay_min=alt_delay,
                reason=alt_reason,
                bed_data_stale=alt_ranked.candidate.bed_data_stale,
            )
        )

    route_detail = SimulatedRouteDetail(
        to_hospital_id=best_ranked.hospital_id,
        distance_km=best_base_eta.distance_km,
        baseline_eta_min=best_base_eta.eta_min,
        simulated_eta_min=best_sim_eta.eta_min,
        delay_min=best_delay,
        polyline=[list(pt) for pt in best_route.polyline],
    )

    warnings: list[WarningDetail] = []
    if best_ranked.candidate.bed_data_stale or any(
        a.candidate.bed_data_stale for a in alt_ranked_list
    ):
        warnings.append(
            WarningDetail(
                code=WarningCode.STALE_HOSPITAL_DATA,
                message=f"Hospital bed counts may be outdated (older than {int(settings.stale_after_minutes)} minutes).",
            )
        )

    if overlay.scenario_id != "normal":
        warnings.append(
            WarningDetail(
                code="SIMULATED_TRAFFIC_ACTIVE",
                message=f"Active simulated traffic scenario '{overlay.name}': travel times reflect demo delays, not live traffic.",
            )
        )

    speed_val = (
        int(settings.average_speed_kmh)
        if settings.average_speed_kmh.is_integer()
        else settings.average_speed_kmh
    )

    assumptions = AssumptionsDetail(
        eta_method=f"road distance / assumed average speed with simulated scenario weights ({overlay.name})",
        average_speed_kmh=speed_val,
        live_traffic=False,
        routing_algorithm=algo,
        hospital_data="DEMO values, not real",
    )

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return SimulatedRecommendResponse(
        case_id=req.case_id,
        scenario=TrafficScenarioSummary(**overlay.to_info().__dict__),
        recommended=recommended,
        alternatives=alternatives,
        route=route_detail,
        warnings=warnings,
        assumptions=assumptions,
        generated_at=generated_at,
    )


@router.get("/api/demo/hospitals", summary="List hospitals inside Bengaluru map coverage")
def demo_hospitals() -> dict[str, Any]:
    try:
        graph = get_road_graph()
    except GraphError as err:
        logger.error("Failed to load road graph: %s", err)
        raise AidFlowError(
            ErrorCode.INTERNAL_ERROR,
            "Road graph file not found. Run: python scripts/setup_graph.py",
            500,
            {},
        ) from err
    repo = load_repository()
    hospitals = []
    for h in repo.all():
        if graph.coverage_box.contains(h.location.lat, h.location.lng):
            hospitals.append(
                {
                    "hospital_id": h.hospital_id,
                    "name": h.name,
                    "locality": h.locality,
                    "lat": h.location.lat,
                    "lng": h.location.lng,
                    "beds_available": h.beds_available,
                    "icu_beds_available": h.icu_beds_available,
                    "specialties": list(h.specialties),
                }
            )
    return {"hospitals": hospitals}


@router.post("/api/demo/route", summary="Calculate route from patient to hospital")
def demo_route(req: DemoRouteRequest, request: Request) -> dict[str, Any]:
    try:
        validate_lat_lng(req.origin_lat, req.origin_lng)
    except CoordinateError as err:
        raise AidFlowError(
            ErrorCode.INVALID_COORDINATES,
            str(err),
            400,
            {"origin_lat": req.origin_lat, "origin_lng": req.origin_lng},
        ) from err

    algo = req.algorithm.lower().strip()
    if algo not in ("astar", "dijkstra"):
        raise AidFlowError(
            ErrorCode.INVALID_REQUEST,
            f"Unknown routing algorithm '{req.algorithm}'. Supported algorithms: 'astar', 'dijkstra'.",
            400,
            {"algorithm": req.algorithm},
        )

    try:
        overlay = get_traffic_overlay(req.scenario)
    except ValueError as err:
        raise AidFlowError(
            ErrorCode.INVALID_REQUEST,
            str(err),
            400,
            {"scenario": req.scenario},
        ) from err

    try:
        graph = get_road_graph()
    except GraphError as err:
        logger.error("Failed to load road graph: %s", err)
        raise AidFlowError(
            ErrorCode.INTERNAL_ERROR,
            "Road graph file not found. Run: python scripts/setup_graph.py",
            500,
            {},
        ) from err

    repo = load_repository()
    hospital = repo.get(req.hospital_id)
    if not hospital:
        raise AidFlowError(
            ErrorCode.INVALID_REQUEST,
            f"Hospital '{req.hospital_id}' not found.",
            400,
            {"hospital_id": req.hospital_id},
        )

    t0 = time.perf_counter()
    try:
        snap_origin = snap_to_road(graph, req.origin_lat, req.origin_lng)
    except OutOfCoverageError as err:
        raise AidFlowError(
            ErrorCode.OUT_OF_COVERAGE,
            str(err),
            422,
            {"origin_lat": req.origin_lat, "origin_lng": req.origin_lng},
        ) from err

    try:
        snap_hosp = snap_hospital(graph, hospital)
    except OutOfCoverageError as err:
        raise AidFlowError(
            ErrorCode.OUT_OF_COVERAGE,
            f"Hospital '{hospital.hospital_id}' location is outside road graph coverage: {err}",
            422,
            {"hospital_id": hospital.hospital_id},
        ) from err

    try:
        route = find_route(
            graph,
            snap_origin.node_id,
            snap_hosp.node_id,
            algorithm=algo,
            overlay=overlay,
        )
    except PathNotFoundError as err:
        raise AidFlowError(
            ErrorCode.NO_ROUTE_FOUND,
            f"No directed road route found from origin (node {snap_origin.node_id}) to hospital '{hospital.hospital_id}' (node {snap_hosp.node_id}) under scenario '{overlay.scenario_id}'.",
            422,
            {
                "origin_node": snap_origin.node_id,
                "hospital_node": snap_hosp.node_id,
                "hospital_id": hospital.hospital_id,
                "scenario": overlay.scenario_id,
            },
        ) from err

    time_ms = (time.perf_counter() - t0) * 1000

    settings: Settings = getattr(request.app.state, "settings", None) or load_settings()
    phys_dist_m = route.total_distance_m
    eff_dist_m = (
        route.effective_cost_m
        if route.effective_cost_m is not None
        else phys_dist_m
    )
    base_dist_eta = calculate_distance_eta(phys_dist_m, settings.average_speed_kmh)
    sim_dist_eta = calculate_distance_eta(eff_dist_m, settings.average_speed_kmh)
    delay_min = round(max(0.0, sim_dist_eta.eta_min - base_dist_eta.eta_min), 1)

    return {
        "status": "ok",
        "hospital": {
            "hospital_id": hospital.hospital_id,
            "name": hospital.name,
            "locality": hospital.locality,
            "lat": hospital.location.lat,
            "lng": hospital.location.lng,
        },
        "origin_snap": {
            "node_id": snap_origin.node_id,
            "distance_m": round(snap_origin.distance_m, 1),
            "coords": snap_origin.coords,
        },
        "hospital_snap": {
            "node_id": snap_hosp.node_id,
            "distance_m": round(snap_hosp.distance_m, 1),
            "coords": snap_hosp.coords,
        },
        "distance_km": round(base_dist_eta.distance_km, 2),
        "distance_m": round(phys_dist_m, 1),
        "baseline_eta_min": base_dist_eta.eta_min,
        "simulated_eta_min": sim_dist_eta.eta_min,
        "delay_min": delay_min,
        "scenario": overlay.scenario_id,
        "node_count": route.node_count,
        "edge_count": route.edge_count,
        "calculation_time_ms": round(time_ms, 2),
        "algorithm": algo,
        "polyline": [list(pt) for pt in route.polyline],
    }


# The browser UI lives in app/static (index.html, styles.css, app.js). It only calls the
# endpoints above and /recommend-hospital, and it is served from the same address.
INDEX_HTML = Path(__file__).resolve().parent.parent / "static" / "index.html"


@router.get("/", include_in_schema=False)
def demo_ui() -> FileResponse:
    """Serve the AidFlow browser UI (demo data, estimated ETA, no live traffic)."""
    return FileResponse(INDEX_HTML, media_type="text/html", headers={"Cache-Control": "no-cache"})
