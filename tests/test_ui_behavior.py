"""Browser-behaviour regression tests for the UI (Phase 6 review fixes).

They load the real page and app.js in headless Chromium, but everything else is faked, so they need
no road graph, no network and no running server:
  - requests to http://aidflow.test/ are answered from app/static and from canned API replies;
  - Leaflet is replaced by a tiny recorder, so the tests can see what the page drew.

They are skipped when Playwright or its Chromium is not installed.
"""

from __future__ import annotations

import json

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

from app.main import STATIC_DIR  # noqa: E402

BASE = "http://aidflow.test"
PICKUP_A = {"lat": 12.9716, "lng": 77.6412}  # first landmark button
PICKUP_B = {"lat": 12.9352, "lng": 77.6245}  # somewhere else, used to move the pin

HOSPITALS = [
    {"hospital_id": "H1", "name": "Demo One", "locality": "Alpha", "lat": 12.972, "lng": 77.642, "beds_available": 5, "icu_beds_available": 1, "specialties": ["ICU"]},
    {"hospital_id": "H2", "name": "Demo Two", "locality": "Beta", "lat": 12.98, "lng": 77.65, "beds_available": 7, "icu_beds_available": 2, "specialties": ["ICU"]},
]

FAKE_LEAFLET = """
(function () {
  var log = window.__log = { groups: [], setViews: [] };
  function mapObj() {
    var m = {};
    ["on", "addLayer", "removeLayer", "invalidateSize", "fitBounds"].forEach(function (k) { m[k] = function () { return m; }; });
    m.setView = function (c) { log.setViews.push(c); return m; };
    m.getZoom = function () { return 12; };
    m.getCenter = function () { return { lat: 12.97, lng: 77.59 }; };
    return m;
  }
  window.L = {
    map: mapObj,
    tileLayer: function () { return { addTo: function () { return this; } }; },
    layerGroup: function () {
      var g = { items: [], addTo: function () { return g; }, clearLayers: function () { g.items.length = 0; } };
      log.groups.push(g); return g;
    },
    divIcon: function (o) { return o; },
    latLngBounds: function (p) { return p; },
    marker: function (ll, o) {
      var mk = { ll: ll, dest: /is-dest/.test(((o || {}).icon || {}).html || "") };
      mk.addTo = function (g) { if (g.items) g.items.push(mk); return mk; };
      ["setIcon", "bindPopup", "on", "openPopup"].forEach(function (k) { mk[k] = function () { return mk; }; });
      mk.setLatLng = function (x) { mk.ll = x; return mk; };
      mk.getLatLng = function () { return { lat: mk.ll[0], lng: mk.ll[1] }; };
      return mk;
    },
    polyline: function (pts) {
      var pl = { pts: pts, line: true };
      pl.addTo = function (g) { if (g.items) g.items.push(pl); return pl; };
      pl.setLatLngs = function (x) { pl.pts = x; return pl; };
      return pl;
    }
  };
})();
"""


def _hospital_reply(hid, name, dist, eta, reason):
    return {"hospital_id": hid, "name": name, "distance_km": dist, "eta_min": eta, "reason": reason, "bed_data_stale": False}


class FakeApi:
    """Canned /recommend-hospital replies. A pickup near PICKUP_B gets a zero-length route."""

    def __init__(self):
        self.recommend_bodies: list[dict] = []

    def recommend(self, body: dict) -> dict:
        self.recommend_bodies.append(body)
        candidate = (body.get("candidate_hospital_ids") or [None])[0]
        hid = candidate or "H1"
        hosp = next(h for h in HOSPITALS if h["hospital_id"] == hid)
        at_hospital = abs(body["origin"]["lat"] - PICKUP_B["lat"]) < 1e-6
        # Distance depends on the pickup, so a wrong pickup would show up as a wrong number.
        far = abs(body["origin"]["lat"] - PICKUP_A["lat"]) < 1e-6
        distance = 0.0 if at_hospital else (2.0 if far else 9.0) + (1.0 if hid == "H2" else 0.0)
        polyline = [[hosp["lat"], hosp["lng"]]] if at_hospital else [
            [body["origin"]["lat"], body["origin"]["lng"]], [hosp["lat"] - 0.001, hosp["lng"]], [hosp["lat"], hosp["lng"]]]
        recommended = _hospital_reply(hid, hosp["name"], distance, round(distance * 2, 1), "Nearest open hospital (test).")
        recommended["location"] = {"lat": hosp["lat"], "lng": hosp["lng"]}
        alternatives = []
        if not candidate and body.get("max_alternatives", 0) > 0:
            alternatives = [_hospital_reply("H2", "Demo Two", 3.0, 6.0, "Open, 2.0 min slower than recommended.")]
        return {
            "recommended": recommended, "alternatives": alternatives,
            "route": {"to_hospital_id": hid, "distance_km": distance, "eta_min": round(distance * 2, 1), "polyline": polyline},
            "warnings": [],
            "assumptions": {"eta_method": "x", "average_speed_kmh": 30.0, "live_traffic": False, "routing_algorithm": "astar", "hospital_data": "DEMO values, not real"},
            "generated_at": "2026-11-10T00:00:00Z",
        }


@pytest.fixture
def page():
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as error:  # Chromium not installed
            pytest.skip(f"Chromium is not available: {error}")
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        pg = context.new_page()
        api = FakeApi()
        pg.api = api  # type: ignore[attr-defined]
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.errors = errors  # type: ignore[attr-defined]

        def handle(route):
            url = route.request.url
            if url.startswith(BASE):
                path = url[len(BASE):].split("?")[0] or "/"
                if path == "/":
                    return route.fulfill(path=str(STATIC_DIR / "index.html"), content_type="text/html")
                if path.startswith("/static/"):
                    ctype = "text/css" if path.endswith(".css") else "text/javascript"
                    return route.fulfill(path=str(STATIC_DIR / path[len("/static/"):]), content_type=ctype)
                if path == "/health":
                    return route.fulfill(json={"status": "ok"})
                if path == "/api/demo/hospitals":
                    return route.fulfill(json={"hospitals": HOSPITALS})
                if path == "/recommend-hospital":
                    return route.fulfill(json=api.recommend(json.loads(route.request.post_data)))
                return route.fulfill(status=404, json={"error": {"code": "NOT_FOUND", "message": "x", "details": {}}})
            if "leaflet.js" in url:
                return route.fulfill(body=FAKE_LEAFLET, content_type="text/javascript")
            return route.abort()  # fonts, leaflet.css, tiles

        pg.route("**/*", handle)
        pg.goto(BASE + "/")
        pg.wait_for_selector("#api-status[data-state=ok]")
        yield pg
        assert not errors, errors
        browser.close()


def _ask(pg, pickup=None):
    """Pick a pickup (default: the first landmark) and press the main button."""
    if pickup is None:
        pg.click("#presets .pill >> nth=0")
    else:
        pg.fill("#lat-input", str(pickup["lat"]))
        pg.fill("#lng-input", str(pickup["lng"]))
        pg.dispatch_event("#lng-input", "change")
    pg.click("#submit-btn")
    pg.wait_for_selector("#result-body .card.rec")


def _route_group(pg):
    """What is currently drawn in the route layer: [{line, dest}, ...]."""
    return pg.evaluate("window.__log.groups[1].items.map(function (i) { return { line: !!i.line, dest: !!i.dest }; })")


# ---------------------------------------------------------------- finding 1


def test_zero_length_route_clears_old_route_and_keeps_destination_marker(page):
    _ask(page)  # normal route first
    assert page.is_visible("#preview-hud")
    assert page.is_enabled("#fit-route-btn")
    assert any(i["line"] for i in _route_group(page))

    page.wait_for_timeout(50)
    _ask(page, PICKUP_B)  # reply has a one-point polyline (pickup at the hospital)

    assert not page.is_visible("#preview-hud"), "old preview controls must be gone"
    assert page.is_disabled("#fit-route-btn")
    items = _route_group(page)
    assert items == [{"line": False, "dest": True}], "no old line, but the destination marker is shown"


def test_zero_length_route_as_first_result_still_shows_destination(page):
    _ask(page, PICKUP_B)
    assert not page.is_visible("#preview-hud")
    assert _route_group(page) == [{"line": False, "dest": True}]


def test_play_on_zero_length_route_explains_instead_of_failing(page):
    _ask(page, PICKUP_B)
    page.click("text=Play route preview")
    page.wait_for_selector(".toast:has-text('no route line to preview')")
    assert not page.is_visible("#preview-hud")


# ---------------------------------------------------------------- finding 2


def test_alternative_route_uses_the_pickup_saved_with_the_result(page):
    _ask(page)  # pickup A, one alternative (H2)
    shown_distance = page.inner_text("#result-body .card.rec .metric .v >> nth=1")
    assert shown_distance.startswith("2.00")

    # Move the pickup pin after the result was shown.
    page.fill("#lat-input", str(PICKUP_B["lat"]))
    page.fill("#lng-input", str(PICKUP_B["lng"]))
    page.dispatch_event("#lng-input", "change")

    page.click(".alt-card >> nth=0")
    page.wait_for_selector(".alt-card[aria-pressed=true]")

    body = page.api.recommend_bodies[-1]
    assert body["candidate_hospital_ids"] == ["H2"]
    assert body["origin"] == PICKUP_A, "must use the pickup of the displayed result, not the moved pin"
    # The recommended card still describes pickup A, and the page says which pickup it used.
    assert page.inner_text("#result-body .card.rec .metric .v >> nth=1").startswith("2.00")
    assert "12.97160, 77.64120" in page.inner_text("#result-body .assume")


def test_alternative_still_works_when_pickup_is_unchanged(page):
    _ask(page)
    page.click(".alt-card >> nth=0")
    page.wait_for_selector(".alt-card[aria-pressed=true]")
    assert page.api.recommend_bodies[-1]["origin"] == PICKUP_A
