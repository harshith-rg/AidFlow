/* AidFlow demo UI. Uses only the existing endpoints:
 *   GET  /health
 *   GET  /api/demo/hospitals
 *   POST /recommend-hospital
 * Hospital data is DEMO data and ETA is an estimate. The route preview moves a marker
 * along the polyline returned by the service. It is a simulation of the route, not a vehicle position.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- helpers */
  var SVG_NS = "http://www.w3.org/2000/svg";
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function h(tag, props) {
    var e = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(parent, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(parent, k); }); return; }
    parent.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function icon(name) {
    var s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("class", "icon");
    s.setAttribute("aria-hidden", "true");
    var u = document.createElementNS(SVG_NS, "use");
    u.setAttribute("href", "#i-" + name);
    s.append(u);
    return s;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  function fmt(n, d) { return Number(n).toFixed(d); }
  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /* ------------------------------------------------------------------ data */
  var NEEDS = [
    ["ICU", "Intensive care (ICU)"], ["TRAUMA", "Trauma surgery"], ["CARDIAC", "Cardiac / cath lab"],
    ["NEURO", "Neuro / stroke"], ["MATERNITY", "Maternity"], ["PAEDIATRIC", "Paediatric"], ["GENERAL", "General medicine"]
  ];
  var PRESETS = [
    { name: "Indiranagar 100 Feet Rd", lat: 12.9716, lng: 77.6412 },
    { name: "Defence Colony Metro", lat: 12.9782, lng: 77.6441 },
    { name: "CMH Road Corner", lat: 12.9789, lng: 77.6384 },
    { name: "Koramangala 80 Ft Rd", lat: 12.9352, lng: 77.6245 }
  ];
  var ERROR_TEXT = {
    OUT_OF_COVERAGE: "This pickup point is outside the loaded road map. Choose a point inside Bengaluru.",
    INVALID_COORDINATES: "The pickup coordinates are not valid.",
    INVALID_REQUEST: "The request was not valid.",
    NO_ELIGIBLE_HOSPITAL: "No demo hospital matches all the selected needs. Remove a need and try again.",
    NO_ROUTE_FOUND: "No road route could be found to any eligible hospital from this pickup point.",
    INTERNAL_ERROR: "The service had a problem. If the road map is missing, run: python scripts/setup_graph.py",
    NETWORK: "Could not reach the AidFlow service. Check that it is running, then try again.",
    TIMEOUT: "The service took too long to answer. Please try again in a moment.",
    BAD_RESPONSE: "The service sent a reply this page could not read. Please try again."
  };
  var API_TIMEOUT_MS = 45000; // tests may set window.AIDFLOW_API_TIMEOUT_MS to a smaller value

  var state = {
    hospitals: [], hospById: {}, hospStatus: "idle", hospError: null,
    origin: null, needs: {}, result: null, shown: null, loading: false, requestId: 0,
    lastCall: null, selectedHosp: null, search: "", specs: {}, sort: "name",
    health: "checking", reduced: false, view: "recommend", showHospMarkers: true
  };

  /* ------------------------------------------------------------------- api */
  function api(method, path, body) {
    var t0 = performance.now();
    var opts = { method: method };
    if (body) { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
    var ctrl = window.AbortController ? new AbortController() : null;
    var timedOut = false, timer = null;
    if (ctrl) {
      opts.signal = ctrl.signal;
      timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, window.AIDFLOW_API_TIMEOUT_MS || API_TIMEOUT_MS);
    }
    function fail(code, status) {
      clearTimeout(timer);
      state.lastCall = { method: method, path: path, status: status || 0, ms: performance.now() - t0 };
      renderStatusbar();
      return { code: code, message: ERROR_TEXT[code] };
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        clearTimeout(timer);
        if (timedOut) throw fail("TIMEOUT", res.status);
        state.lastCall = { method: method, path: path, status: res.status, ms: performance.now() - t0 };
        renderStatusbar();
        if (!res.ok) {
          var e = (data && data.error) || { code: "HTTP_" + res.status, message: "Unexpected response (" + res.status + ")." };
          e.status = res.status;
          throw e;
        }
        if (data === null) throw fail("BAD_RESPONSE", res.status);
        return data;
      });
    }, function () {
      throw fail(timedOut ? "TIMEOUT" : "NETWORK");
    });
  }

  /* ----------------------------------------------------------------- toasts */
  function toast(msg, kind) {
    var box = $("#toasts");
    var t = h("div", { class: "toast" + (kind === "error" ? " error" : ""), role: kind === "error" ? "alert" : "status", text: msg });
    box.append(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  /* ------------------------------------------------------------------ theme */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    store.set("aidflow-theme", t);
    var dark = t === "dark";
    var btn = $("#theme-btn");
    btn.setAttribute("aria-pressed", String(dark));
    $("#theme-label").textContent = dark ? "Light mode" : "Dark mode";
    $("#theme-icon use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
  }
  function initTheme() {
    applyTheme(document.documentElement.getAttribute("data-theme") || "light");
    $("#theme-btn").addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      toast(next === "dark" ? "Dark mode on" : "Light mode on");
    });
  }

  /* ---------------------------------------------------------- reduced motion */
  function osReduced() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function motionOff() { return state.reduced || osReduced(); }
  function applyReduced(on) {
    state.reduced = on;
    if (on) document.documentElement.setAttribute("data-reduced", "1"); else document.documentElement.removeAttribute("data-reduced");
    store.set("aidflow-reduced", on ? "1" : "0");
    var b = $("#motion-btn");
    b.setAttribute("aria-pressed", String(on));
    b.title = on ? "Turn route animation back on" : "Turn route animation off";
    if (on && preview.playing) pausePreview();
  }
  function initMotion() {
    applyReduced(store.get("aidflow-reduced") === "1");
    $("#motion-btn").addEventListener("click", function () {
      applyReduced(!state.reduced);
      toast(state.reduced ? "Animation off. The route preview shows the whole route." : "Animation on");
    });
  }

  /* ------------------------------------------------------------- navigation */
  function showView(name, opts) {
    if (["recommend", "hospitals", "overview"].indexOf(name) < 0) name = "recommend";
    state.view = name;
    ["recommend", "hospitals", "overview"].forEach(function (v) { $("#view-" + v).hidden = v !== name; });
    $$(".nav-item").forEach(function (b) {
      if (b.dataset.view === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (!(opts && opts.noHash)) { try { history.replaceState(null, "", "#/" + name); } catch (e) { /* ignore */ } }
    closeNav();
    if (name === "recommend") setTimeout(function () { if (map) map.invalidateSize(); }, 50);
    if (name === "hospitals") renderHospitals();
    if (name === "overview") renderOverview();
  }
  function openNav() { document.body.classList.add("nav-open"); $("#scrim").hidden = false; $("#menu-btn").setAttribute("aria-expanded", "true"); }
  function closeNav() { document.body.classList.remove("nav-open"); $("#scrim").hidden = true; $("#menu-btn").setAttribute("aria-expanded", "false"); }
  function setTab(tab) {
    $("#view-recommend").dataset.tab = tab;
    $$(".tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === tab)); });
    if (tab === "map") setTimeout(function () { if (map) { map.invalidateSize(); fitShown(); } }, 60);
  }
  function initNav() {
    $$(".nav-item").forEach(function (b) { b.addEventListener("click", function () { showView(b.dataset.view); }); });
    $("#menu-btn").addEventListener("click", openNav);
    $("#menu-close").addEventListener("click", closeNav);
    $("#scrim").addEventListener("click", closeNav);
    $$(".tab").forEach(function (t) { t.addEventListener("click", function () { setTab(t.dataset.tab); }); });
    window.addEventListener("hashchange", function () { showView((location.hash || "").replace("#/", ""), { noHash: true }); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
      var tag = (e.target && e.target.tagName) || "";
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey &&
          tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA" && state.view === "recommend") {
        toggleTheater();
      }
    });
    var dlg = $("#about-dialog");
    function openAbout() { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
    function closeAbout() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
    $("#about-btn").addEventListener("click", openAbout);
    $("#about-close").addEventListener("click", closeAbout);
    $("#about-ok").addEventListener("click", closeAbout);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) closeAbout(); });
  }

  /* ----------------------------------------------------------------- health */
  function checkHealth(announce) {
    state.health = "checking"; renderHealth();
    return api("GET", "/health").then(function (d) {
      state.health = d && d.status === "ok" ? "ok" : "down";
    }, function () { state.health = "down"; }).then(function () {
      renderHealth();
      if (announce) toast(state.health === "ok" ? "Service is online." : "Service is not reachable.", state.health === "ok" ? "" : "error");
      if (state.view === "overview") renderOverview();
    });
  }
  function renderHealth() {
    var chip = $("#api-status");
    chip.dataset.state = state.health;
    $("#api-status-text").textContent = state.health === "ok" ? "Service: online" : state.health === "down" ? "Service: offline" : "Service: checking…";
  }
  function renderStatusbar() {
    var c = state.lastCall;
    $("#sb-last").textContent = c
      ? "Last request: " + c.method + " " + c.path + " → " + (c.status || "no response") + " · " + Math.round(c.ms) + " ms (browser round trip)"
      : "No request yet.";
    var a = state.result && state.result.assumptions;
    $("#sb-assume").textContent = a
      ? "DEMO DATA · Estimated ETA at " + a.average_speed_kmh + " km/h · live traffic: " + (a.live_traffic ? "yes" : "no") + " · routing: " + String(a.routing_algorithm).toUpperCase()
      : "DEMO DATA · Estimated ETA, no live traffic";
  }

  /* -------------------------------------------------------------------- map */
  var map = null, layers = {}, markers = {}, originMarker = null;

  function mkIcon(cls, html, size) {
    return L.divIcon({ className: "", html: '<div class="mk ' + cls + '">' + (html || "") + "</div>", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }
  function initMap() {
    var host = $("#map");
    if (!window.L) {
      host.append(h("div", { class: "map-msg" }, h("div", null, h("strong", { text: "The map library could not be loaded." }), h("p", { text: "Check your internet connection and reload. Routing results still appear in the Result panel." }))));
      ["toggle-hosp-btn", "fit-route-btn", "recenter-btn"].forEach(function (id) { $("#" + id).disabled = true; });
      return;
    }
    map = L.map("map", { zoomControl: true }).setView([12.9716, 77.5946], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
    layers.hospitals = L.layerGroup().addTo(map);
    layers.route = L.layerGroup().addTo(map);
    layers.preview = L.layerGroup().addTo(map);
    map.on("click", function (e) { setOrigin(e.latlng.lat, e.latlng.lng, "Pin on map"); });
  }
  function drawHospitalMarkers() {
    if (!map) return;
    layers.hospitals.clearLayers(); markers = {};
    state.hospitals.forEach(function (hp) {
      var m = L.marker([hp.lat, hp.lng], { icon: mkIcon("mk-h", "+", 22), title: hp.name, keyboard: true });
      var pop = h("div", null,
        h("strong", { text: hp.name }), h("br"), h("span", { text: hp.locality }), h("br"),
        h("span", { text: "Demo beds: " + hp.beds_available + " · ICU: " + hp.icu_beds_available }), h("br"),
        h("button", { class: "btn btn-small", type: "button", onclick: function () { selectHospital(hp.hospital_id); showView("hospitals"); } }, "Details"));
      m.bindPopup(pop);
      m.addTo(layers.hospitals);
      markers[hp.hospital_id] = m;
    });
    if (!state.showHospMarkers) map.removeLayer(layers.hospitals);
  }
  function setOrigin(lat, lng, name) {
    var err = validateLatLng(lat, lng);
    if (err) { showOriginError(err); return false; }
    state.origin = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, name: name || "Custom point" };
    $("#lat-input").value = fmt(state.origin.lat, 6);
    $("#lng-input").value = fmt(state.origin.lng, 6);
    showOriginError(null);
    $("#origin-summary").textContent = "Pickup: " + state.origin.name + " (" + fmt(state.origin.lat, 5) + ", " + fmt(state.origin.lng, 5) + ")";
    $$("#presets .pill").forEach(function (p) { p.setAttribute("aria-pressed", String(p.dataset.name === state.origin.name)); });
    if (map) {
      if (!originMarker) {
        originMarker = L.marker([state.origin.lat, state.origin.lng], { icon: mkIcon("mk-o", "", 24), draggable: true, title: "Pickup point (drag to move)", zIndexOffset: 1000 }).addTo(map);
        originMarker.on("dragend", function () { var p = originMarker.getLatLng(); setOrigin(p.lat, p.lng, "Pin on map"); });
      } else originMarker.setLatLng([state.origin.lat, state.origin.lng]);
    }
    return true;
  }
  function validateLatLng(lat, lng) {
    if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng)) return "Latitude and longitude must be numbers.";
    if (lat < -90 || lat > 90) return "Latitude must be between -90 and 90.";
    if (lng < -180 || lng > 180) return "Longitude must be between -180 and 180.";
    return null;
  }
  function showOriginError(msg) {
    var box = $("#origin-error");
    box.hidden = !msg; box.textContent = msg || "";
    $("#lat-input").setAttribute("aria-invalid", msg ? "true" : "false");
    $("#lng-input").setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function fitShown() {
    if (!map || !state.shown) return;
    var pts = state.shown.route.polyline;
    if (pts && pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    else if (pts && pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 15));
  }
  function toggleTheater() {
    if (window.matchMedia && matchMedia("(max-width: 1023.98px)").matches) return; // compact layouts use the Map tab
    var on = !document.body.classList.contains("theater");
    document.body.classList.toggle("theater", on);
    var b = $("#theater-btn");
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Shrink map" : "Enlarge map");
    $("#theater-icon use").setAttribute("href", on ? "#i-shrink" : "#i-expand");
    $("#panel-map").scrollIntoView({ block: "start" });
    setTimeout(function () { if (map) { map.invalidateSize(); if (state.shown) fitShown(); } }, 80);
  }

  /* ------------------------------------------------------- route + preview */
  var preview = { pts: [], cum: [0], total: 0, t: 0, playing: false, speed: 1, raf: 0, last: 0, dur: 10000, marker: null, covered: null };
  var SPEEDS = [1, 2, 4];

  function drawRoute(shown) {
    stopPreview(true);
    // Always start from a clean state, so a previous route or preview never stays on screen.
    $("#preview-hud").hidden = true;
    $("#fit-route-btn").disabled = true;
    if (!map) return;
    layers.route.clearLayers(); layers.preview.clearLayers();
    Object.keys(markers).forEach(function (id) { markers[id].setIcon(mkIcon("mk-h", "+", 22)); });
    var pts = shown.route.polyline || [];
    var hp = state.hospById[shown.hospitalId];
    var end = pts.length ? pts[pts.length - 1] : (hp ? [hp.lat, hp.lng] : null);
    if (end) L.marker(end, { icon: mkIcon("mk-h is-dest", "+", 30), title: shown.name, zIndexOffset: 900 }).addTo(layers.route);
    if (pts.length < 2) {
      // Pickup is at the hospital: no line to draw or preview, but still show where it is.
      if (end) map.setView(end, Math.max(map.getZoom(), 15));
      return;
    }
    L.polyline(pts, { color: "#885CF6", weight: 11, opacity: 0.25, lineCap: "round" }).addTo(layers.route);
    L.polyline(pts, { color: "#885CF6", weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(layers.route);
    preparePreview(pts);
    $("#fit-route-btn").disabled = false;
    $("#preview-hud").hidden = false;
    setProgress(0);
    fitShown();
  }
  function clearRoute() {
    stopPreview(true);
    if (map) { layers.route.clearLayers(); layers.preview.clearLayers(); }
    $("#preview-hud").hidden = true;
    $("#fit-route-btn").disabled = true;
    state.shown = null;
  }
  function preparePreview(pts) {
    preview.pts = pts; preview.cum = [0];
    for (var i = 1; i < pts.length; i++) preview.cum.push(preview.cum[i - 1] + haversine(pts[i - 1], pts[i]));
    preview.total = preview.cum[preview.cum.length - 1];
    preview.dur = Math.min(20000, Math.max(6000, preview.total / 1000 * 2500));
    preview.t = 0;
    preview.marker = L.marker(pts[0], { icon: mkIcon("mk-p", "", 18), interactive: false, zIndexOffset: 1100 }).addTo(layers.preview);
    preview.covered = L.polyline([pts[0]], { color: "#cfbdff", weight: 4, opacity: 1, lineCap: "round" }).addTo(layers.preview);
  }
  function pointAt(frac) {
    var d = frac * preview.total, c = preview.cum, lo = 0, hi = c.length - 1;
    while (lo < hi - 1) { var mid = (lo + hi) >> 1; if (c[mid] <= d) lo = mid; else hi = mid; }
    var seg = c[hi] - c[lo], f = seg > 0 ? (d - c[lo]) / seg : 0;
    var a = preview.pts[lo], b = preview.pts[hi];
    return { idx: lo, pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] };
  }
  function setProgress(frac) {
    frac = Math.max(0, Math.min(1, frac));
    preview.t = frac;
    if (preview.pts.length) {
      var p = pointAt(frac);
      if (preview.marker) preview.marker.setLatLng(p.pos);
      if (preview.covered) preview.covered.setLatLngs(preview.pts.slice(0, p.idx + 1).concat([p.pos]));
    }
    $("#pv-scrub").value = String(Math.round(frac * 1000));
    var ro = $("#pv-readout"); clear(ro);
    ro.append(Math.round(frac * 100) + "% of route · " + fmt(frac * preview.total / 1000, 2) + " of " + fmt(preview.total / 1000, 2) + " km", h("span", { class: "hide-sm", text: " along the returned route line" }));
  }
  function setPlayIcon(playing) {
    $("#pv-play-icon use").setAttribute("href", playing ? "#i-pause" : "#i-play");
    $("#pv-play").setAttribute("aria-label", playing ? "Pause route preview" : "Play route preview");
  }
  function tick(ts) {
    if (!preview.playing) return;
    var dt = ts - preview.last; preview.last = ts;
    var next = preview.t + dt * preview.speed / preview.dur;
    if (next >= 1) { setProgress(1); preview.playing = false; setPlayIcon(false); return; }
    setProgress(next);
    preview.raf = requestAnimationFrame(tick);
  }
  function playPreview() {
    if (!state.shown) return;
    if (preview.pts.length < 2) { toast("The pickup point is at the hospital, so there is no route line to preview."); return; }
    if (motionOff()) { setProgress(1); toast("Animation is off, so the whole route is shown."); return; }
    if (preview.t >= 1) setProgress(0);
    preview.playing = true; setPlayIcon(true);
    preview.last = performance.now();
    preview.raf = requestAnimationFrame(tick);
  }
  function pausePreview() { preview.playing = false; cancelAnimationFrame(preview.raf); setPlayIcon(false); }
  function stopPreview(reset) {
    pausePreview();
    if (reset) { preview.t = 0; preview.marker = null; preview.covered = null; preview.pts = []; }
  }
  function initPreview() {
    $("#pv-play").addEventListener("click", function () { if (preview.playing) pausePreview(); else playPreview(); });
    $("#pv-replay").addEventListener("click", function () { setProgress(0); pausePreview(); playPreview(); });
    $("#pv-scrub").addEventListener("input", function (e) { pausePreview(); setProgress(Number(e.target.value) / 1000); });
    $("#pv-speed").addEventListener("click", function () {
      preview.speed = SPEEDS[(SPEEDS.indexOf(preview.speed) + 1) % SPEEDS.length];
      $("#pv-speed").textContent = preview.speed + "×";
    });
  }

  /* ---------------------------------------------------------- recommend flow */
  function currentNeeds() { return NEEDS.map(function (n) { return n[0]; }).filter(function (k) { return state.needs[k]; }); }

  function submitRecommend(opts) {
    opts = opts || {};
    if (state.loading) return;
    if (!state.origin) {
      var lat = parseFloat($("#lat-input").value), lng = parseFloat($("#lng-input").value);
      if (!setOrigin(lat, lng, "Custom point")) { if (!$("#origin-error").textContent) showOriginError("Choose a pickup point first."); setTab("intake"); return; }
    }
    state.lastRequest = opts; // so "Try again" repeats exactly this request
    var body = { origin: { lat: state.origin.lat, lng: state.origin.lng }, needs: opts.candidate ? [] : currentNeeds(), max_alternatives: opts.candidate ? 0 : Number($("#alt-count").value) };
    if (opts.candidate) body.candidate_hospital_ids = [opts.candidate];
    var myId = ++state.requestId;
    setLoading(true);
    renderResult("loading");
    setTab("result");
    api("POST", "/recommend-hospital", body).then(function (data) {
      if (myId !== state.requestId) return;
      state.result = data;
      state.resultOrigin = { lat: body.origin.lat, lng: body.origin.lng }; // pickup this result was calculated for
      state.resultKind = opts.candidate ? "single" : "recommend";
      state.resultAltRequested = body.max_alternatives;
      state.shown = shownFrom(data.recommended, data.route);
      renderResult("ok");
      drawRoute(state.shown);
      renderStatusbar();
      if (state.view === "overview") renderOverview();
    }).catch(function (err) {
      if (myId !== state.requestId) return;
      state.result = null;
      clearRoute();
      renderResult("error", err);
    }).then(function () { if (myId === state.requestId) setLoading(false); });
  }
  function shownFrom(hosp, route) { return { hospitalId: hosp.hospital_id, name: hosp.name, route: route }; }

  function viewAlternative(id) {
    if (state.loading || !state.result || !state.resultOrigin) return;
    if (state.shown && state.shown.hospitalId === id) { playPreviewIfShown(); return; }
    var alt = state.result.alternatives.filter(function (a) { return a.hospital_id === id; })[0];
    var myId = ++state.requestId;
    setLoading(true);
    state.altLoading = id;
    renderResult("ok");
    api("POST", "/recommend-hospital", { origin: { lat: state.resultOrigin.lat, lng: state.resultOrigin.lng }, needs: [], max_alternatives: 0, candidate_hospital_ids: [id] })
      .then(function (data) {
        if (myId !== state.requestId) return;
        state.altLoading = null;
        state.shown = shownFrom(alt || data.recommended, data.route);
        renderResult("ok");
        drawRoute(state.shown);
        toast("Showing the route to " + state.shown.name + ".");
      }).catch(function (err) { if (myId === state.requestId) { state.altLoading = null; renderResult("ok"); } if (myId === state.requestId) toast((ERROR_TEXT[err.code] || err.message || "Could not load that route."), "error"); })
      .then(function () { if (myId === state.requestId) setLoading(false); });
  }
  function showRecommendedAgain() {
    if (!state.result) return;
    var r = state.result;
    state.shown = shownFrom(r.recommended, r.route);
    renderResult("ok"); drawRoute(state.shown);
  }
  function playPreviewIfShown() { setTab("map"); playPreview(); }

  function setLoading(on) {
    state.loading = on;
    clearTimeout(state.slowTimer);
    if (on) state.slowTimer = setTimeout(function () {
      var sk = $("#result-body .skeleton");
      if (sk && !$("#slow-hint")) sk.after(h("p", { class: "hint", id: "slow-hint", text: "Still calculating… routing on the full city map can take a few seconds." }));
    }, 6000);
    var b = $("#submit-btn");
    b.disabled = on;
    clear($("#submit-label"));
    $("#submit-label").textContent = on ? "Calculating route…" : "Find hospital & route";
    var old = $("#submit-btn .spinner"); if (old) old.remove();
    if (on) b.insertBefore(h("span", { class: "spinner", "aria-hidden": "true" }), b.firstChild);
    var ic = $("#submit-btn > svg"); if (ic) ic.style.display = on ? "none" : "";
  }

  function errorBox(err) {
    var text = ERROR_TEXT[err.code] || err.message || "Something went wrong.";
    return h("div", { class: "error-box", role: "alert" },
      h("code", { text: err.code || "ERROR" }),
      h("p", { text: text }),
      err.code === "INTERNAL_ERROR" && err.message ? h("p", { class: "hint", text: err.message }) : null,
      h("button", { class: "btn btn-small", type: "button", onclick: function () { submitRecommend(state.lastRequest || {}); } }, "Try again"));
  }

  function renderResult(kind, err) {
    var box = $("#result-body"); clear(box);
    if (kind === "loading") {
      box.append(h("div", { class: "skeleton", "aria-busy": "true", "aria-label": "Calculating" }, h("div", { class: "skel big" }), h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel big" })));
      return;
    }
    if (kind === "error") { box.append(errorBox(err)); return; }
    var r = state.result;
    if (!r) {
      box.append(h("div", { class: "state-box" }, h("strong", { text: "No recommendation yet" }),
        "Choose a pickup point and press “Find hospital & route”."));
      return;
    }
    var shownId = state.shown && state.shown.hospitalId;
    var rec = r.recommended, hp = state.hospById[rec.hospital_id];
    var single = state.resultKind === "single";

    if (r.warnings && r.warnings.length) {
      r.warnings.forEach(function (w) {
        box.append(h("div", { class: "alert", role: "note" }, icon("alert"), h("div", null, h("strong", { text: w.code === "STALE_HOSPITAL_DATA" ? "Bed data may be out of date. " : w.code + ": " }), w.message)));
      });
    }

    var card = h("div", { class: "card rec" },
      h("div", { class: "card-label", text: single ? "Route to selected hospital" : "Recommended" }),
      h("h3", { text: rec.name }),
      h("div", { class: "sub", text: (hp ? hp.locality + " · " : "") + rec.hospital_id }),
      h("div", { class: "metrics" },
        h("div", { class: "metric" }, h("div", { class: "v" }, fmt(rec.eta_min, 1), h("small", { text: " min" })), h("div", { class: "k", text: "Estimated ETA" })),
        h("div", { class: "metric" }, h("div", { class: "v" }, fmt(rec.distance_km, 2), h("small", { text: " km" })), h("div", { class: "k", text: "Road distance" }))),
      h("p", { class: "reason", text: rec.reason }),
      h("div", null,
        h("span", { class: "badge badge-demo", text: "DEMO DATA" }),
        rec.bed_data_stale ? h("span", { class: "badge badge-stale", text: "BED DATA MAY BE STALE" }) : null),
      hp ? h("div", { class: "cap" },
        h("div", null, h("b", { text: String(hp.icu_beds_available) }), h("span", { text: "ICU beds (demo)" })),
        h("div", null, h("b", { text: String(hp.beds_available) }), h("span", { text: "Beds (demo)" }))) : null);
    box.append(card);

    if (r.alternatives && r.alternatives.length) {
      box.append(h("div", { class: "section-label", text: "Alternatives (" + r.alternatives.length + ")" }));
      var recBtn = shownId !== rec.hospital_id
        ? h("button", { class: "btn btn-small", type: "button", onclick: showRecommendedAgain, style: "margin-bottom:8px" }, "Show recommended route again") : null;
      if (recBtn) box.append(recBtn);
      r.alternatives.forEach(function (a) {
        var busy = state.altLoading === a.hospital_id;
        box.append(h("button", { class: "alt-card", type: "button", "aria-pressed": String(shownId === a.hospital_id), disabled: !!state.altLoading, "aria-busy": busy ? "true" : null, onclick: function () { viewAlternative(a.hospital_id); } },
          h("div", { class: "row" }, h("span", { class: "name", text: a.name }), h("span", { class: "num", text: "Est. " + fmt(a.eta_min, 1) + " min · " + fmt(a.distance_km, 2) + " km" })),
          h("div", { class: "reason", text: a.reason }),
          a.bed_data_stale ? h("span", { class: "badge badge-stale", text: "BED DATA MAY BE STALE" }) : null,
          h("span", { class: "badge badge-demo", text: busy ? "LOADING ROUTE…" : shownId === a.hospital_id ? "ROUTE SHOWN ON MAP" : "VIEW ROUTE ON MAP" })));
      });
    }
    if (!single && state.resultAltRequested > 0 && r.alternatives.length < state.resultAltRequested) {
      box.append(h("p", { class: "hint", style: "margin:6px 0 0" }, r.alternatives.length
        ? "Only " + r.alternatives.length + " of " + state.resultAltRequested + " requested alternatives were found."
        : "No alternative hospital was found: no other eligible hospital with a road route from this pickup."));
    }

    box.append(h("div", { class: "actions" },
      h("button", { class: "btn btn-primary", type: "button", onclick: function () { setTab("map"); playPreview(); } }, icon("play"), "Play route preview"),
      h("button", { class: "btn", type: "button", onclick: function () { setTab("map"); fitShown(); } }, icon("map"), "Show on map"),
      h("button", { class: "btn", type: "button", onclick: copyJson }, icon("copy"), "Copy result JSON"),
      h("button", { class: "btn", type: "button", onclick: downloadJson }, icon("download"), "Download JSON")));

    var a = r.assumptions || {};
    box.append(h("p", { class: "assume" },
      "ETA = road distance ÷ assumed average speed (" + a.average_speed_kmh + " km/h). Live traffic: " + (a.live_traffic ? "yes" : "no") +
      ". Routing: " + String(a.routing_algorithm).toUpperCase() + ". Hospital data: " + a.hospital_data + ". Pickup used: " + fmt(state.resultOrigin.lat, 5) + ", " + fmt(state.resultOrigin.lng, 5) + ". Generated " + r.generated_at + "."));
  }

  function resultJson() { return JSON.stringify(state.result, null, 2); }
  function copyJson() {
    if (!state.result) return;
    var text = resultJson();
    function fallback() {
      var ta = h("textarea", { "aria-hidden": "true", style: "position:fixed;left:-999px" }); ta.value = text;
      document.body.append(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove(); toast(ok ? "Result JSON copied." : "Could not copy. Use Download JSON instead.", ok ? "" : "error");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Result JSON copied."); }, fallback);
    } else fallback();
  }
  function downloadJson() {
    if (!state.result) return;
    var blob = new Blob([resultJson()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: "aidflow-recommendation-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Result JSON downloaded.");
  }

  function resetAll() {
    state.requestId++; setLoading(false);
    state.origin = null; state.needs = {}; state.result = null; state.resultOrigin = null; state.lastRequest = null; state.altLoading = null;
    clearRoute();
    if (originMarker && map) { map.removeLayer(originMarker); originMarker = null; }
    $("#lat-input").value = ""; $("#lng-input").value = "";
    $("#origin-summary").textContent = "No pickup point chosen yet.";
    showOriginError(null);
    $$("#presets .pill").forEach(function (p) { p.setAttribute("aria-pressed", "false"); });
    $$("#needs-list input").forEach(function (i) { i.checked = false; });
    $("#alt-count").value = "2";
    renderResult("empty"); renderStatusbar();
    toast("Cleared.");
  }

  function initForm() {
    var presets = $("#presets");
    PRESETS.forEach(function (p) {
      presets.append(h("button", { class: "pill", type: "button", "data-name": p.name, "aria-pressed": "false", onclick: function () {
        setOrigin(p.lat, p.lng, p.name);
        if (map) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 13));
      } }, p.name));
    });
    var needs = $("#needs-list");
    NEEDS.forEach(function (n) {
      var cb = h("input", { type: "checkbox", value: n[0], onchange: function (e) { state.needs[n[0]] = e.target.checked; } });
      needs.append(h("label", { class: "need" }, cb, h("span", { text: n[1] }), h("code", { text: n[0] })));
    });
    function fromInputs() {
      var lat = parseFloat($("#lat-input").value), lng = parseFloat($("#lng-input").value);
      if ($("#lat-input").value.trim() === "" || $("#lng-input").value.trim() === "") return;
      if (setOrigin(lat, lng, "Custom point") && map) map.setView([lat, lng], Math.max(map.getZoom(), 13));
    }
    $("#lat-input").addEventListener("change", fromInputs);
    $("#lng-input").addEventListener("change", fromInputs);
    $("#use-center-btn").addEventListener("click", function () {
      if (!map) { toast("The map is not available.", "error"); return; }
      var c = map.getCenter(); setOrigin(c.lat, c.lng, "Map centre");
    });
    $("#rec-form").addEventListener("submit", function (e) { e.preventDefault(); submitRecommend(); });
    $("#reset-btn").addEventListener("click", resetAll);
    $("#toggle-hosp-btn").addEventListener("click", function () {
      state.showHospMarkers = !state.showHospMarkers;
      $("#toggle-hosp-btn").setAttribute("aria-pressed", String(state.showHospMarkers));
      if (!map) return;
      if (state.showHospMarkers) map.addLayer(layers.hospitals); else map.removeLayer(layers.hospitals);
    });
    $("#fit-route-btn").addEventListener("click", fitShown);
    $("#recenter-btn").addEventListener("click", function () {
      if (!map) return;
      if (state.hospitals.length) map.fitBounds(L.latLngBounds(state.hospitals.map(function (x) { return [x.lat, x.lng]; })), { padding: [30, 30] });
      else map.setView([12.9716, 77.5946], 12);
    });
    $("#theater-btn").addEventListener("click", toggleTheater);
  }

  /* --------------------------------------------------------------- hospitals */
  function loadHospitals() {
    state.hospStatus = "loading"; state.hospError = null;
    if (state.view === "hospitals") renderHospitals();
    return api("GET", "/api/demo/hospitals").then(function (d) {
      state.hospitals = d.hospitals || [];
      state.hospById = {};
      state.hospitals.forEach(function (x) { state.hospById[x.hospital_id] = x; });
      state.hospStatus = "ok";
      setMapNote(null);
      drawHospitalMarkers();
      if (state.result) renderResult("ok");
    }).catch(function (err) {
      state.hospStatus = "error"; state.hospError = err;
      setMapNote("Hospital markers could not be loaded (" + (err.code || "ERROR") + "). You can still choose a pickup point and ask for a recommendation.");
    }).then(function () {
      if (state.view === "hospitals") renderHospitals();
      if (state.view === "overview") renderOverview();
    });
  }
  function setMapNote(msg) {
    var box = $("#map-note"); clear(box);
    box.hidden = !msg;
    if (msg) box.append(msg + " ", h("button", { class: "btn btn-small", type: "button", onclick: loadHospitals }, "Retry"));
  }
  function allSpecs() {
    var s = {};
    state.hospitals.forEach(function (x) { x.specialties.forEach(function (k) { s[k] = (s[k] || 0) + 1; }); });
    return s;
  }
  function filteredHospitals() {
    var q = state.search.trim().toLowerCase();
    var active = Object.keys(state.specs).filter(function (k) { return state.specs[k]; });
    var list = state.hospitals.filter(function (x) {
      if (q && (x.name + " " + x.locality + " " + x.hospital_id).toLowerCase().indexOf(q) < 0) return false;
      return active.every(function (k) { return x.specialties.indexOf(k) >= 0; });
    });
    list.sort(function (a, b) {
      if (state.sort === "beds") return b.beds_available - a.beds_available || a.name.localeCompare(b.name);
      if (state.sort === "icu") return b.icu_beds_available - a.icu_beds_available || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return list;
  }
  function renderSpecFilters() {
    var box = $("#spec-filters"); clear(box);
    var counts = allSpecs();
    Object.keys(counts).sort().forEach(function (k) {
      box.append(h("button", { class: "pill", type: "button", "aria-pressed": String(!!state.specs[k]), onclick: function () { state.specs[k] = !state.specs[k]; renderHospitals(); } }, k + " (" + counts[k] + ")"));
    });
  }
  function renderHospitals() {
    var list = $("#hosp-list"); clear(list);
    var count = $("#hosp-count");
    var detail = $("#hosp-detail");
    renderSpecFilters();
    if (state.hospStatus === "loading" || state.hospStatus === "idle") {
      count.textContent = "Loading hospitals…";
      for (var i = 0; i < 6; i++) list.append(h("div", { class: "hosp" }, h("div", { class: "skeleton" }, h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel" }))));
      return;
    }
    if (state.hospStatus === "error") {
      count.textContent = "";
      var e = state.hospError || {};
      list.append(h("div", { class: "error-box", role: "alert", style: "grid-column:1/-1" }, h("code", { text: e.code || "ERROR" }), h("p", { text: ERROR_TEXT[e.code] || e.message || "Could not load hospitals." }),
        h("button", { class: "btn btn-small", type: "button", onclick: loadHospitals }, "Try again")));
      return;
    }
    if (!state.hospitals.length) {
      count.textContent = "";
      list.append(h("div", { class: "state-box", style: "grid-column:1/-1" }, h("strong", { text: "No demo hospitals are inside the loaded map coverage" }),
        "Check that the road map file matches the demo area (python scripts/setup_graph.py), then reload.",
        h("div", null, h("button", { class: "btn btn-small", type: "button", style: "margin-top:10px", onclick: loadHospitals }, "Reload"))));
      detail.hidden = true;
      return;
    }
    var items = filteredHospitals();
    count.textContent = "Showing " + items.length + " of " + state.hospitals.length + " demo hospitals inside the map coverage.";
    if (!items.length) {
      list.append(h("div", { class: "state-box", style: "grid-column:1/-1" }, h("strong", { text: "No hospitals match" }), "Try a different search or clear the filters.",
        h("div", null, h("button", { class: "btn btn-small", type: "button", style: "margin-top:10px", onclick: resetFilters }, "Reset filters"))));
    }
    items.forEach(function (x) {
      list.append(h("button", { class: "hosp", type: "button", "aria-pressed": String(state.selectedHosp === x.hospital_id), onclick: function () { selectHospital(x.hospital_id); } },
        h("div", { class: "name", text: x.name }), h("div", { class: "loc", text: x.locality + " · " + x.hospital_id }),
        h("div", { class: "nums" }, h("div", null, String(x.beds_available), h("span", { text: " beds" })), h("div", null, String(x.icu_beds_available), h("span", { text: " ICU" }))),
        h("div", { class: "tags" }, x.specialties.map(function (s) { return h("span", { class: "tag-s", text: s }); }))));
    });
    var sel = state.selectedHosp && state.hospById[state.selectedHosp];
    detail.hidden = !sel;
    $(".explorer").classList.toggle("has-detail", !!sel);
    if (sel) renderDetail(sel);
  }
  function renderDetail(x) {
    var d = $("#hosp-detail"); clear(d);
    d.append(
      h("button", { class: "icon-btn detail-close", type: "button", "aria-label": "Close details", onclick: function () { state.selectedHosp = null; renderHospitals(); } }, icon("x")),
      h("div", { class: "card-label", text: "Hospital details" }),
      h("h3", { text: x.name }),
      h("div", null, h("span", { class: "badge badge-demo", text: "DEMO DATA" })),
      h("dl", null,
        h("dt", { text: "ID" }), h("dd", { text: x.hospital_id }),
        h("dt", { text: "Area" }), h("dd", { text: x.locality }),
        h("dt", { text: "Location" }), h("dd", { text: fmt(x.lat, 4) + ", " + fmt(x.lng, 4) }),
        h("dt", { text: "Beds (demo)" }), h("dd", { text: String(x.beds_available) }),
        h("dt", { text: "ICU beds (demo)" }), h("dd", { text: String(x.icu_beds_available) }),
        h("dt", { text: "Specialties" }), h("dd", { text: x.specialties.join(", ") })),
      h("div", { class: "actions" },
        h("button", { class: "btn btn-primary", type: "button", onclick: function () { routeToHospital(x.hospital_id); } }, icon("route"), "Estimate route from pickup"),
        h("button", { class: "btn", type: "button", onclick: function () { showHospitalOnMap(x.hospital_id); } }, icon("pin"), "Show on map")),
      h("p", { class: "hint", style: "margin-top:10px", text: "Bed counts are invented demo values. Status and last-update time are not available in this view." }));
  }
  function selectHospital(id) { state.selectedHosp = id; renderHospitals(); }
  function showHospitalOnMap(id) {
    var x = state.hospById[id]; if (!x) return;
    showView("recommend"); setTab("map");
    if (map) setTimeout(function () { map.invalidateSize(); map.setView([x.lat, x.lng], 15); if (markers[id]) markers[id].openPopup(); }, 80);
  }
  function routeToHospital(id) {
    showView("recommend");
    if (!state.origin) {
      setTab("intake");
      showOriginError("Choose a pickup point first, then press “Find hospital & route” or pick the hospital again.");
      toast("Choose a pickup point first.", "error");
      return;
    }
    submitRecommend({ candidate: id });
  }
  function resetFilters() {
    state.search = ""; state.specs = {}; state.sort = "name";
    $("#hosp-search").value = ""; $("#hosp-sort").value = "name";
    renderHospitals();
  }
  function initHospitals() {
    $("#hosp-search").addEventListener("input", function (e) { state.search = e.target.value; renderHospitals(); });
    $("#hosp-sort").addEventListener("change", function (e) { state.sort = e.target.value; renderHospitals(); });
    $("#hosp-reset").addEventListener("click", resetFilters);
    $("#hosp-refresh").addEventListener("click", function () { loadHospitals().then(function () { toast(state.hospStatus === "ok" ? "Hospital list reloaded." : "Could not reload the hospital list.", state.hospStatus === "ok" ? "" : "error"); }); });
  }

  /* ---------------------------------------------------------------- overview */
  function renderOverview() {
    var box = $("#overview-body"); clear(box);
    var hs = state.hospitals;
    var beds = hs.reduce(function (s, x) { return s + x.beds_available; }, 0);
    var icu = hs.reduce(function (s, x) { return s + x.icu_beds_available; }, 0);
    var ok = state.hospStatus === "ok";
    box.append(h("div", { class: "stat-grid" },
      stat("Hospitals in coverage", ok ? String(hs.length) : "—"),
      stat("Beds available (demo)", ok ? String(beds) : "—"),
      stat("ICU beds available (demo)", ok ? String(icu) : "—"),
      stat("Service", state.health === "ok" ? "Online" : state.health === "down" ? "Offline" : "Checking")));
    if (state.hospStatus === "error") {
      box.append(h("div", { class: "error-box", role: "alert" }, h("code", { text: (state.hospError && state.hospError.code) || "ERROR" }), h("p", { text: ERROR_TEXT[state.hospError && state.hospError.code] || "Could not load hospital data." })));
    }
    var counts = allSpecs(), max = Math.max.apply(null, [1].concat(Object.keys(counts).map(function (k) { return counts[k]; })));
    var bars = h("div", { class: "bars" });
    Object.keys(counts).sort().forEach(function (k) {
      bars.append(h("div", { class: "bar-row" }, h("span", { text: k }), h("div", { class: "bar" }, h("i", { style: "width:" + (counts[k] / max * 100) + "%" })), h("b", { text: String(counts[k]) })));
    });
    var r = state.result, a = r && r.assumptions;
    var last = h("div", { class: "panel" }, h("h3", { class: "panel-title", text: "Latest recommendation" }));
    if (!r) last.append(h("p", { class: "hint", text: "No recommendation yet. Use the Recommend page." }));
    else last.append(h("dl", { class: "kv" },
      h("dt", { text: "Hospital" }), h("dd", { text: r.recommended.name }),
      h("dt", { text: "Estimated ETA" }), h("dd", { text: fmt(r.recommended.eta_min, 1) + " min" }),
      h("dt", { text: "Road distance" }), h("dd", { text: fmt(r.recommended.distance_km, 2) + " km" }),
      h("dt", { text: "Alternatives" }), h("dd", { text: String(r.alternatives.length) }),
      h("dt", { text: "Warnings" }), h("dd", { text: r.warnings.length ? r.warnings.map(function (w) { return w.code; }).join(", ") : "none" }),
      h("dt", { text: "Speed assumed" }), h("dd", { text: a.average_speed_kmh + " km/h" }),
      h("dt", { text: "Live traffic" }), h("dd", { text: a.live_traffic ? "yes" : "no" }),
      h("dt", { text: "Algorithm" }), h("dd", { text: String(a.routing_algorithm).toUpperCase() })));
    box.append(h("div", { class: "two-col" },
      h("div", { class: "panel" }, h("h3", { class: "panel-title", text: "Specialties covered" }),
        ok && hs.length ? bars : h("p", { class: "hint", text: state.hospStatus === "error" ? "Unavailable: the hospital list could not be loaded." : ok ? "No hospitals are inside the loaded map coverage." : "Loading…" })),
      last,
      h("div", { class: "panel" }, h("h3", { class: "panel-title", text: "How to read this" }),
        h("p", { class: "hint", text: "All hospitals are fictional demo data. Beds and specialties are invented. ETA is road distance divided by an assumed speed, with no live traffic. Nothing here dispatches or tracks a vehicle." }))));
  }
  function stat(k, v) { return h("div", { class: "stat" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v })); }
  function initOverview() {
    $("#ov-refresh").addEventListener("click", function () { checkHealth(false); loadHospitals(); });
    $("#api-status").addEventListener("click", function () { checkHealth(true); });
  }

  /* -------------------------------------------------------------------- init */
  function init() {
    initTheme(); initMotion(); initNav(); initMap(); initForm(); initPreview(); initHospitals(); initOverview();
    renderResult("empty"); renderStatusbar(); setPlayIcon(false);
    showView((location.hash || "").replace("#/", "") || "recommend", { noHash: true });
    checkHealth(false);
    loadHospitals();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
