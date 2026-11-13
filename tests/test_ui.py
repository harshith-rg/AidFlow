"""The browser UI (app/static) is served, keeps its honesty labels, and only uses existing endpoints.

These are file/serving checks. The behaviour in a real browser (themes, layout, route preview) was
checked separately with a headless browser; see README, "Browser UI".
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import STATIC_DIR, create_app

# Endpoints the UI is allowed to call. Adding one here means the backend gained it.
ALLOWED_CALLS = {
    ("GET", "/health"),
    ("GET", "/api/demo/hospitals"),
    ("POST", "/recommend-hospital"),
    ("POST", "/api/demo/recommend-simulated"),
}


@pytest.fixture(scope="module")
def client():
    return TestClient(create_app(Settings()))


@pytest.fixture(scope="module")
def html(client) -> str:
    return client.get("/").text


@pytest.fixture(scope="module")
def js() -> str:
    return (STATIC_DIR / "app.js").read_text(encoding="utf-8")


def test_root_serves_the_new_page(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "AidFlow" in response.text
    assert "Phase 3 Live Demo" not in response.text  # the old inline page is gone


def test_static_assets_are_served(client, html):
    for path in re.findall(r'(?:href|src)="(/static/[^"]+)"', html):
        response = client.get(path)
        assert response.status_code == 200, path
    assert client.get("/static/app.js").headers["content-type"].split(";")[0] in (
        "text/javascript",
        "application/javascript",
    )
    assert client.get("/static/nope.js").status_code == 404


def test_demo_data_and_eta_labels_are_in_the_page(html):
    assert "DEMO DATA — NOT REAL HOSPITAL AVAILABILITY" in html
    assert "Estimated ETA" in html
    assert "live traffic not used" in html
    assert "nothing is dispatched or tracked" in html


def test_page_has_no_live_tracking_or_dispatch_claims(html, js):
    text = html + js
    for phrase in ("ALS-14", "Live Tracking", "LIVE ALS", "Dispatch Ambulance", "Pre-Admit", "Lock Corridor"):
        assert phrase.lower() not in text.lower(), phrase
    # The preview is explicitly labelled as a simulation.
    assert "not a live ambulance position" in html


def test_ui_only_calls_existing_endpoints(js):
    calls = set(re.findall(r'api\("(GET|POST)",\s*"([^"]+)"', js))
    assert calls == ALLOWED_CALLS
    assert "fetch(" in js and js.count("fetch(") == 1  # every request goes through api()


def test_route_preview_uses_the_returned_polyline(js):
    assert "route.polyline" in js or ".polyline" in js
    assert "preparePreview(pts)" in js
    assert "pts = shown.route.polyline" in js


def test_every_id_the_script_looks_up_exists_in_the_page(html, js):
    wanted = {i for i in re.findall(r'\$\("#([A-Za-z0-9_-]+)', js) if not i.endswith("-")}
    wanted |= {m for m in re.findall(r'"#((?:view|panel)-[a-z]+)"', js)}
    present = set(re.findall(r'\bid="([^"]+)"', html))
    # ids built from a prefix, e.g. "#view-" + name
    wanted |= {f"view-{v}" for v in ("recommend", "hospitals", "overview")}
    wanted -= {"slow-hint"}  # created by app.js itself when a request is slow
    missing = sorted(i for i in wanted if i not in present)
    assert not missing, f"ids used by app.js but missing in index.html: {missing}"


def test_every_visible_button_is_wired(html, js):
    """Each static button has an id or data attribute the script binds to."""
    buttons = re.findall(r"<button\b([^>]*)>", html)
    assert buttons
    for attrs in buttons:
        id_match = re.search(r'\bid="([^"]+)"', attrs)
        if id_match:
            assert f'#{id_match.group(1)}"' in js, f"button #{id_match.group(1)} is not used by app.js"
        else:
            assert "data-view" in attrs or "data-tab" in attrs, f"unwired button: {attrs}"


def test_theme_and_motion_controls_exist(html, js):
    assert 'data-theme="light"' in html
    assert "prefers-color-scheme" in html  # initial theme follows the system
    assert 'id="theme-btn"' in html and 'id="motion-btn"' in html
    css = (STATIC_DIR / "styles.css").read_text(encoding="utf-8")
    assert ':root[data-theme="dark"]' in css
    assert "prefers-reduced-motion" in css and 'data-reduced="1"' in css
    assert "@media (max-width: 1023.98px)" in css  # compact layout


def test_script_has_valid_syntax():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    result = subprocess.run([node, "--check", str(Path(STATIC_DIR) / "app.js")], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_existing_endpoints_still_work(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/openapi.json").status_code == 200


def test_phase7_labels_and_states_are_in_the_files(html, js):
    css = (STATIC_DIR / "styles.css").read_text(encoding="utf-8")
    # labels: map, Hospitals page, Overview page and a status bar that stays in view
    assert 'class="tag tag-demo map-badge">DEMO DATA' in html
    assert html.count("DEMO DATA —") >= 3
    assert html.index('id="sb-assume"') < html.index('id="sb-last"')
    assert ".statusbar { position: sticky; bottom: 0" in css
    assert '"Est. " + fmt(a.eta_min' in js  # alternative ETA says it is an estimate
    # states
    for code in ("TIMEOUT", "BAD_RESPONSE", "NETWORK"):
        assert code in js
    assert "LOADING ROUTE" in js and "state.lastRequest" in js
    assert "No demo hospitals are inside the loaded map coverage" in js


def test_map_legend_elements_are_in_the_page(html):
    assert 'id="map-legend"' in html
    assert 'id="legend-toggle-btn"' in html
    assert 'id="legend-body"' in html
    assert "Pickup point (P)" in html
    assert "Recommended (#1)" in html
    assert "Alternative (#2, #3…)" in html
    assert "Hospital (+)" in html
    assert "Selected route" in html
