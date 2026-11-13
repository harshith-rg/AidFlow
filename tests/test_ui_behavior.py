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
      var mk = { ll: ll, dest: /is-dest/.test(((o || {}).icon || {}).html || ""), icon: (o || {}).icon };
      mk.addTo = function (g) { if (g.items) g.items.push(mk); return mk; };
      mk.setIcon = function (i) { mk.icon = i; return mk; };
      ["bindPopup", "on", "openPopup"].forEach(function (k) { mk[k] = function () { return mk; }; });
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
        self.hospitals = list(HOSPITALS)  # what /api/demo/hospitals returns
        self.hospitals_fail = False
        self.no_alternatives = False
        self.bad_json = False  # next /recommend-hospital reply is not JSON
        self.fail_candidate_once = False  # next single-hospital request returns 500
        self.hold = None  # "alt" or "any": keep matching requests pending until released
        self.held = None  # the held Playwright route

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
        if not candidate and body.get("max_alternatives", 0) > 0 and not self.no_alternatives:
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
                    if api.hospitals_fail:
                        return route.fulfill(status=500, json={"error": {"code": "INTERNAL_ERROR", "message": "Road graph file not found.", "details": {}}})
                    return route.fulfill(json={"hospitals": api.hospitals})
                if path == "/recommend-hospital":
                    body = json.loads(route.request.post_data)
                    single = bool(body.get("candidate_hospital_ids"))
                    if api.bad_json:
                        return route.fulfill(status=200, body="<html>oops</html>", content_type="text/html")
                    if single and api.fail_candidate_once:
                        api.fail_candidate_once = False
                        api.recommend_bodies.append(body)
                        return route.fulfill(status=500, json={"error": {"code": "INTERNAL_ERROR", "message": "boom", "details": {}}})
                    if api.hold == "any" or (api.hold == "alt" and single):
                        api.held = (route, api.recommend(body))
                        return None  # leave the request pending; the test decides when it ends
                    return route.fulfill(json=api.recommend(body))
                if path == "/api/demo/recommend-simulated":
                    body = json.loads(route.request.post_data)
                    rec = api.recommend(body)
                    scenario = body.get("scenario", "moderate")
                    mult = 1.6 if scenario == "moderate" else (2.5 if scenario == "heavy" else 1.0)
                    base_eta = rec["recommended"]["eta_min"]
                    sim_eta = round(base_eta * mult, 1)
                    delay = round(sim_eta - base_eta, 1)
                    return route.fulfill(
                        json={
                            "case_id": body.get("case_id"),
                            "scenario": {
                                "scenario_id": scenario,
                                "name": f"Simulated {scenario.title()}",
                                "description": "Demo scenario",
                                "corridor_factor": mult,
                                "non_corridor_factor": 1.0,
                                "has_closure": scenario == "closure",
                                "closed_edges_count": 1 if scenario == "closure" else 0,
                                "disclaimer": "SIMULATED TRAFFIC DEMO",
                            },
                            "recommended": {
                                "hospital_id": rec["recommended"]["hospital_id"],
                                "name": rec["recommended"]["name"],
                                "location": rec["recommended"].get("location"),
                                "distance_km": rec["recommended"]["distance_km"],
                                "baseline_eta_min": base_eta,
                                "simulated_eta_min": sim_eta,
                                "delay_min": delay,
                                "reason": rec["recommended"]["reason"],
                                "bed_data_stale": False,
                            },
                            "alternatives": [],
                            "route": {
                                "to_hospital_id": rec["recommended"]["hospital_id"],
                                "distance_km": rec["route"]["distance_km"],
                                "baseline_eta_min": base_eta,
                                "simulated_eta_min": sim_eta,
                                "delay_min": delay,
                                "polyline": rec["route"]["polyline"],
                            },
                            "warnings": [],
                            "assumptions": {
                                "eta_method": "simulated",
                                "average_speed_kmh": 30.0,
                                "live_traffic": False,
                                "routing_algorithm": "astar",
                                "hospital_data": "DEMO values",
                            },
                            "generated_at": "2026-11-10T00:00:00Z",
                        }
                    )
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


# ----------------------------------------------------------- Phase 7 polish


def test_alternative_shows_busy_state_while_its_route_loads(page):
    _ask(page)
    page.api.hold = "alt"
    page.click(".alt-card >> nth=0")
    page.wait_for_selector(".alt-card[aria-busy=true]")
    assert page.is_disabled(".alt-card >> nth=0"), "cards are locked while a route is loading"
    assert "LOADING ROUTE" in page.inner_text(".alt-card[aria-busy=true]")
    route, reply = page.api.held
    route.fulfill(json=reply)
    page.wait_for_selector(".alt-card[aria-pressed=true]")
    assert page.is_enabled(".alt-card >> nth=0")
    assert "Est. " in page.inner_text(".alt-card >> nth=0"), "alternative ETA is labelled as an estimate"


def test_request_that_never_answers_times_out_and_offers_retry(page):
    page.evaluate("window.AIDFLOW_API_TIMEOUT_MS = 300")
    page.api.hold = "any"
    page.click("#presets .pill >> nth=0")
    page.click("#submit-btn")
    page.wait_for_selector(".error-box:has-text('TIMEOUT')")
    assert "took too long" in page.inner_text(".error-box")
    assert page.is_enabled("#submit-btn"), "the form must be usable again after a timeout"
    assert page.is_visible(".error-box >> text=Try again")


def test_unreadable_reply_is_reported_not_swallowed(page):
    page.api.bad_json = True
    page.click("#presets .pill >> nth=0")
    page.click("#submit-btn")
    page.wait_for_selector(".error-box:has-text('BAD_RESPONSE')")
    assert page.is_enabled("#submit-btn")


def test_try_again_repeats_the_single_hospital_request(page):
    page.click("#presets .pill >> nth=0")
    page.api.fail_candidate_once = True
    page.click(".nav-item[data-view=hospitals]")
    page.click(".hosp >> nth=1")  # H2
    page.click("text=Estimate route from pickup")
    page.wait_for_selector(".error-box:has-text('INTERNAL_ERROR')")
    page.click(".error-box >> text=Try again")
    page.wait_for_selector("#result-body .card.rec")
    last = page.api.recommend_bodies[-1]
    assert last["candidate_hospital_ids"] == ["H2"], "retry must repeat the single-hospital request"
    assert "route to selected hospital" in page.inner_text("#result-body").lower()


def test_missing_alternatives_are_explained(page):
    page.api.no_alternatives = True
    _ask(page)
    assert "No alternative hospital was found" in page.inner_text("#result-body")


def test_empty_hospital_list_has_its_own_message(page):
    page.api.hospitals = []
    page.click(".nav-item[data-view=hospitals]")
    page.click("#hosp-refresh")
    page.wait_for_selector("text=No demo hospitals are inside the loaded map coverage")
    assert page.locator("text=Reset filters").count() == 1  # only the toolbar button, not an empty-state one
    page.click(".nav-item[data-view=overview]")
    assert "No hospitals are inside the loaded map coverage" in page.inner_text("#overview-body")


def test_hospital_list_failure_is_visible_on_every_page(page):
    page.api.hospitals_fail = True
    page.click(".nav-item[data-view=overview]")
    page.click("#ov-refresh")
    page.wait_for_selector("#overview-body .error-box")
    assert "Unavailable" in page.inner_text("#overview-body")
    assert "Loading" not in page.inner_text("#overview-body"), "must not show Loading… after a failure"
    page.click(".nav-item[data-view=recommend]")
    assert page.is_visible("#map-note")
    page.api.hospitals_fail = False
    page.click("#map-note >> text=Retry")
    page.wait_for_selector("#map-note", state="hidden")


def test_demo_labels_stay_visible_on_every_page(page):
    for view in ("recommend", "hospitals", "overview"):
        page.click(f".nav-item[data-view={view}]")
        assert page.is_visible("text=DEMO DATA >> nth=0"), view
    # the status bar keeps the label in view while the page scrolls
    page.click(".nav-item[data-view=recommend]")
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    box = page.locator(".statusbar").bounding_box()
    assert box["y"] + box["height"] <= 800 + 1 and box["y"] >= 0
    assert "DEMO DATA" in page.inner_text(".statusbar")
    assert "DEMO DATA" in page.inner_text(".map-badge")


def test_no_sideways_scroll_on_the_smallest_phone(page):
    page.set_viewport_size({"width": 320, "height": 640})
    _ask(page)  # result with an alternative card ("Est. ... min · ... km")
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"page is {overflow}px wider than the screen"
    page.click(".tab[data-tab=map]")
    assert page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0


def test_traffic_scenario_controls_and_eta_display(page):
    _ask(page)
    # Check default is normal
    assert page.get_attribute("#scen-normal", "aria-pressed") == "true"
    assert page.get_attribute("#scen-moderate", "aria-pressed") == "false"
    assert "Normal" in page.inner_text("#scenario-desc")

    # Switch to Moderate Congestion
    page.click("#scen-moderate")
    assert page.get_attribute("#scen-moderate", "aria-pressed") == "true"
    assert page.get_attribute("#scen-normal", "aria-pressed") == "false"
    assert "Moderate" in page.inner_text("#scenario-desc")

    # Verify simulated ETA and labels appear in the result
    page.wait_for_selector("text=SIMULATED:")
    assert "Simulated ETA" in page.inner_text("#result-body")
    assert "base" in page.inner_text("#result-body")
    assert "Road distance (physical)" in page.inner_text("#result-body")

    # Reset restores normal
    page.click("#reset-btn")
    assert page.get_attribute("#scen-normal", "aria-pressed") == "true"
    assert page.get_attribute("#scen-moderate", "aria-pressed") == "false"


def test_map_legend_and_marker_clarity(page):
    # Desktop: map panel and legend are directly visible
    assert page.is_visible("#map-legend")
    legend_text = page.inner_text("#map-legend")
    assert "LEGEND" in legend_text
    assert "Pickup point (P)" in legend_text
    assert "Recommended (#1)" in legend_text
    assert "Alternative" in legend_text
    assert "Hospital (+)" in legend_text
    assert "Selected route" in legend_text

    # Toggle legend collapse/expand
    assert page.get_attribute("#legend-toggle-btn", "aria-expanded") == "true"
    page.click("#legend-toggle-btn")
    assert page.get_attribute("#legend-toggle-btn", "aria-expanded") == "false"
    assert not page.is_visible("#legend-body")
    page.click("#legend-toggle-btn")
    assert page.get_attribute("#legend-toggle-btn", "aria-expanded") == "true"
    assert page.is_visible("#legend-body")

    # Run recommendation to check marker distinction
    _ask(page)
    icons = page.evaluate("window.__log.groups[0].items.map(function (m) { return ((m.icon || {}).html || ''); })")
    # Recommended marker should have is-rec and "★ 1"
    assert any("is-rec" in ic and "★ 1" in ic for ic in icons), f"Expected recommended marker in {icons}"
    # Alternative marker should have is-alt and "2"
    assert any("is-alt" in ic and "2" in ic for ic in icons), f"Expected alternative marker in {icons}"

    # Route group should have destination marker with is-dest and is-rec
    route_icons = page.evaluate("window.__log.groups[1].items.filter(function (m) { return m.dest; }).map(function (m) { return ((m.icon || {}).html || ''); })")
    assert len(route_icons) == 1
    assert "is-dest" in route_icons[0]
    assert "is-rec" in route_icons[0]
    assert "★ 1" in route_icons[0]

    # View alternative and verify destination marker updates
    page.click(".alt-card >> nth=0")
    page.wait_for_selector(".alt-card[aria-pressed=true]")
    route_icons_alt = page.evaluate("window.__log.groups[1].items.filter(function (m) { return m.dest; }).map(function (m) { return ((m.icon || {}).html || ''); })")
    assert len(route_icons_alt) == 1
    assert "is-dest" in route_icons_alt[0]
    assert "is-alt" in route_icons_alt[0]
    assert "2" in route_icons_alt[0]

    # Mobile check: on phone width 320px, map tab shows legend without overflow
    page.set_viewport_size({"width": 320, "height": 640})
    page.click(".tab[data-tab=map]")
    assert page.is_visible("#map-legend")
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"page overflowed horizontally by {overflow}px"
