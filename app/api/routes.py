"""URL routes of the service.

Phase 1 has GET /health.
Phase 3 adds an interactive Leaflet map interface at GET / and demo routing APIs.
POST /recommend-hospital is added in Phase 5.
"""

import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.data.hospital_repository import load_repository
from app.models.schemas import HealthResponse
from app.services.graph_loader import get_road_graph
from app.services.routing import find_route
from app.services.snapping import OutOfCoverageError, snap_hospital, snap_to_road

router = APIRouter()


@router.get("/health", response_model=HealthResponse, summary="Is the service running?")
def health() -> HealthResponse:
    """CONTRACT.md section 3: returns exactly {"status": "ok"}."""
    return HealthResponse(status="ok")


# ---------------------------------------------------------------------------
# Phase 3 Interactive Live Map Demo
# ---------------------------------------------------------------------------
class DemoRouteRequest(BaseModel):
    origin_lat: float
    origin_lng: float
    hospital_id: str
    algorithm: str = "astar"


@router.get("/api/demo/hospitals", summary="List hospitals inside Bengaluru map coverage")
def demo_hospitals() -> dict[str, Any]:
    graph = get_road_graph()
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
def demo_route(req: DemoRouteRequest) -> dict[str, Any]:
    graph = get_road_graph()
    repo = load_repository()
    hospital = repo.get(req.hospital_id)
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")

    t0 = time.perf_counter()
    try:
        snap_origin = snap_to_road(graph, req.origin_lat, req.origin_lng)
    except OutOfCoverageError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err

    snap_hosp = snap_hospital(graph, hospital)
    route = find_route(
        graph, snap_origin.node_id, snap_hosp.node_id, algorithm=req.algorithm
    )
    time_ms = (time.perf_counter() - t0) * 1000

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
        "distance_km": round(route.distance_km, 2),
        "distance_m": round(route.total_distance_m, 1),
        "node_count": route.node_count,
        "edge_count": route.edge_count,
        "calculation_time_ms": round(time_ms, 2),
        "algorithm": req.algorithm,
        "polyline": [list(pt) for pt in route.polyline],
    }


DEMO_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AidFlow Emergency Routing — Interactive Map (Phase 3)</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; display: flex; height: 100vh; background: #0f172a; color: #f8fafc; }
    #sidebar {
      width: 420px;
      min-width: 360px;
      background: #1e293b;
      border-right: 1px solid #334155;
      display: flex;
      flex-direction: column;
      box-shadow: 4px 0 24px rgba(0,0,0,0.4);
      z-index: 1000;
    }
    .header {
      padding: 20px 24px;
      border-bottom: 1px solid #334155;
      background: linear-gradient(135deg, #1e293b, #0f172a);
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 4px 8px;
      border-radius: 4px;
      background: #ef4444;
      color: white;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .title { font-size: 20px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
    .subtitle { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .content { padding: 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 20px; }
    .control-group { display: flex; flex-direction: column; gap: 8px; }
    label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #cbd5e1; }
    select, button {
      width: 100%;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: all 0.2s;
    }
    select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25); }
    .btn-primary {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      font-weight: 600;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
    }
    .btn-primary:hover { background: linear-gradient(135deg, #3b82f6, #2563eb); transform: translateY(-1px); }
    .btn-primary:active { transform: translateY(1px); }
    .info-card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 14px 16px;
      font-size: 13px;
      color: #cbd5e1;
    }
    .info-card strong { color: #60a5fa; }
    .stats-card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 16px;
      display: none;
      flex-direction: column;
      gap: 12px;
    }
    .stats-header { font-size: 13px; font-weight: 700; color: #10b981; display: flex; align-items: center; gap: 6px; }
    .stat-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding-bottom: 6px; border-bottom: 1px dashed #334155; }
    .stat-row:last-child { border-bottom: none; padding-bottom: 0; }
    .stat-label { color: #94a3b8; }
    .stat-val { font-weight: 600; color: #fff; }
    #map { flex: 1; height: 100%; z-index: 1; }
    .pulse-pin {
      width: 14px;
      height: 14px;
      background: #2563eb;
      border-radius: 50%;
      border: 3px solid #fff;
      box-shadow: 0 0 12px rgba(37,99,235,0.8);
    }
  </style>
</head>
<body>
  <div id="sidebar">
    <div class="header">
      <span class="badge">Phase 3 Live Demo</span>
      <div class="title">🚑 AidFlow Routing</div>
      <div class="subtitle">Central Bengaluru Emergency Ambulance Routing</div>
    </div>
    <div class="content">
      <div class="info-card">
        📍 <strong>Patient / Ambulance Location</strong><br>
        <span id="coords-display">12.9760°N, 77.5920°E</span><br>
        <small style="color:#94a3b8;">💡 Click anywhere on the map to move the ambulance.</small>
      </div>

      <div class="control-group">
        <label for="hospital-select">Destination Hospital</label>
        <select id="hospital-select"></select>
      </div>

      <div class="control-group">
        <label for="algo-select">Routing Algorithm</label>
        <select id="algo-select">
          <option value="astar">A* Algorithm (Admissible Haversine Heuristic)</option>
          <option value="dijkstra">Dijkstra Algorithm (Uniform-Cost Search)</option>
        </select>
      </div>

      <button id="route-btn" class="btn-primary">
        ⚡ Calculate Shortest Road Route
      </button>

      <div id="stats-box" class="stats-card">
        <div class="stats-header">✓ Shortest Road Route Computed</div>
        <div class="stat-row">
          <span class="stat-label">Road Distance</span>
          <span id="stat-dist" class="stat-val" style="color:#38bdf8; font-size:15px;">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Intersections (Nodes)</span>
          <span id="stat-nodes" class="stat-val">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Edges Traversed</span>
          <span id="stat-edges" class="stat-val">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Snapping: Origin Node</span>
          <span id="stat-origin-snap" class="stat-val">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Snapping: Hospital Node</span>
          <span id="stat-hosp-snap" class="stat-val">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Calculation Time</span>
          <span id="stat-time" class="stat-val" style="color:#a7f3d0;">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Polyline Points</span>
          <span id="stat-points" class="stat-val">-</span>
        </div>
      </div>
    </div>
  </div>
  <div id="map"></div>

  <script>
    // 1. Initialize Map centered on Bengaluru
    const map = L.map('map').setView([12.9760, 77.5920], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    let originLat = 12.9760;
    let originLng = 77.5920;
    let ambulanceMarker = null;
    let routeLayer = null;
    let hospitalMarkers = {};

    // Custom Icons
    const ambulanceIcon = L.divIcon({
      className: 'custom-icon',
      html: '<div style="background:#2563eb; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 10px rgba(0,0,0,0.5); font-size:18px;">🚑</div>',
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const hospitalIcon = L.divIcon({
      className: 'custom-icon',
      html: '<div style="background:#ef4444; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 10px rgba(0,0,0,0.5); font-size:16px;">🏥</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    // Create Ambulance Marker
    ambulanceMarker = L.marker([originLat, originLng], { icon: ambulanceIcon, draggable: true }).addTo(map);
    ambulanceMarker.bindPopup("<b>Ambulance / Patient Location</b><br>Drag me or click anywhere on the map!");

    function updateOrigin(lat, lng) {
      originLat = lat;
      originLng = lng;
      ambulanceMarker.setLatLng([lat, lng]);
      document.getElementById('coords-display').innerText = `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
    }

    ambulanceMarker.on('dragend', function(e) {
      const pos = e.target.getLatLng();
      updateOrigin(pos.lat, pos.lng);
    });

    map.on('click', function(e) {
      updateOrigin(e.latlng.lat, e.latlng.lng);
    });

    // 2. Fetch Hospitals inside coverage
    fetch('/api/demo/hospitals')
      .then(res => res.json())
      .then(data => {
        const select = document.getElementById('hospital-select');
        data.hospitals.forEach(h => {
          const opt = document.createElement('option');
          opt.value = h.hospital_id;
          opt.innerText = `[${h.hospital_id}] ${h.name} (${h.locality})`;
          select.appendChild(opt);

          const marker = L.marker([h.lat, h.lng], { icon: hospitalIcon }).addTo(map);
          marker.bindPopup(`
            <b style="color:#0f172a;">${h.name}</b><br>
            <span style="color:#475569;">${h.locality}</span><br>
            <b>ICU Beds:</b> ${h.icu_beds_available}<br>
            <b>Total Available:</b> ${h.beds_available}<br>
            <button onclick="selectHospital('${h.hospital_id}')" style="margin-top:6px; padding:4px 8px; font-size:11px; background:#2563eb; color:#fff; border:none; border-radius:4px; cursor:pointer;">Select as Destination</button>
          `);
          hospitalMarkers[h.hospital_id] = marker;
        });

        if (data.hospitals.length > 0) {
          selectHospital(data.hospitals[0].hospital_id);
        }
      });

    window.selectHospital = function(id) {
      document.getElementById('hospital-select').value = id;
      if (hospitalMarkers[id]) {
        hospitalMarkers[id].openPopup();
      }
    };

    // 3. Compute Route
    document.getElementById('route-btn').addEventListener('click', function() {
      const hospitalId = document.getElementById('hospital-select').value;
      const algorithm = document.getElementById('algo-select').value;
      const btn = document.getElementById('route-btn');
      btn.innerText = "⏳ Computing Road Path...";
      btn.disabled = true;

      fetch('/api/demo/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_lat: originLat,
          origin_lng: originLng,
          hospital_id: hospitalId,
          algorithm: algorithm
        })
      })
      .then(res => {
        if (!res.ok) {
          return res.json().then(err => { throw new Error(err.detail || "Routing failed"); });
        }
        return res.json();
      })
      .then(data => {
        // Remove previous route
        if (routeLayer) { map.removeLayer(routeLayer); }

        // Draw new polyline
        routeLayer = L.polyline(data.polyline, {
          color: algorithm === 'astar' ? '#2563eb' : '#059669',
          weight: 6,
          opacity: 0.85,
          lineJoin: 'round'
        }).addTo(map);

        map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

        // Update Stats Card
        document.getElementById('stats-box').style.display = 'flex';
        document.getElementById('stat-dist').innerText = `${data.distance_km} km (${data.distance_m} m)`;
        document.getElementById('stat-nodes').innerText = `${data.node_count} nodes`;
        document.getElementById('stat-edges').innerText = `${data.edge_count} road segments`;
        document.getElementById('stat-origin-snap').innerText = `Node ${data.origin_snap.node_id} (${data.origin_snap.distance_m} m)`;
        document.getElementById('stat-hosp-snap').innerText = `Node ${data.hospital_snap.node_id} (${data.hospital_snap.distance_m} m)`;
        document.getElementById('stat-time').innerText = `${data.calculation_time_ms} ms (${data.algorithm.toUpperCase()})`;
        document.getElementById('stat-points').innerText = `${data.polyline.length} coordinates`;
      })
      .catch(err => {
        alert("Routing error: " + err.message);
      })
      .finally(() => {
        btn.innerText = "⚡ Calculate Shortest Road Route";
        btn.disabled = false;
      });
    });
  </script>
</body>
</html>
"""


@router.get("/", response_class=HTMLResponse, summary="Interactive Demo Map UI")
def demo_ui() -> HTMLResponse:
    """Serve the interactive Leaflet map interface directly in the browser."""
    return HTMLResponse(content=DEMO_HTML)
