import React, { useEffect, useMemo, useState, useRef } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './control-room.css'
import Logo from '../components/Logo'
import ControlRoomAlertToast from '../components/ControlRoomAlertToast'
import {
  emergencyStore,
  type EmergencyRecord,
  type AmbulanceUnit,
  type EmergencyStatus,
  findRecommendedAmbulance,
  calculateDistanceKm,
} from '../services/emergencyStore'
import { api } from '../api/client'
import { onSocketEvent, subscribeConnectionState } from '../realtime/socket'
import { emergencyCaseToRecord } from '../services/caseAdapter'
import hospitalDirectory from '../data/hospital_directory.json'
import bengaluruAmbulances from '../data/bengaluru_ambulances_demo.json'

// Custom Leaflet Icons
const emergencyMarkerIcon = (severity: string) =>
  L.divIcon({
    className: `aidflow-emergency-marker ${severity.toLowerCase()}`,
    html: `<span>${severity === 'Critical' ? '🚨' : severity === 'High' ? '⚠️' : '📍'}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  })

const ambulanceMarkerIcon = (status: string) =>
  L.divIcon({
    className: `aidflow-ambulance-marker green ${status === 'Available' ? 'available' : 'busy'}`,
    html: '<span>🚑</span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  })

const hospitalCanvasRenderer = L.canvas({ padding: 0.5 })

type HospitalPin = { id: string; name: string; lat: number; lng: number; address: string; source: string }
const hospitalDirectoryRows = hospitalDirectory as Array<{ id: string; name: string; lat: number; lng: number; address?: string; district?: string; state?: string; phone?: string; beds?: number | null; icuBeds?: number | null; specialties?: string }>
const hospitalById = new Map(hospitalDirectoryRows.map(h => [h.id, h]))
const directoryHospitalPins: HospitalPin[] = hospitalDirectoryRows
  .filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lng) && h.lat !== 0 && h.lng !== 0)
  .map(h => ({ id: h.id, name: String(h.name || 'Hospital').replace(/\s*\n\s*/g, ' ').trim(), lat: h.lat, lng: h.lng, address: h.address || [h.district, h.state].filter(Boolean).join(', '), source: 'Supplied hospital directory' }))
const syntheticFleet: AmbulanceUnit[] = (bengaluruAmbulances as Array<{id:string;label?:string;vehicleNumber?:string;driver?:string;driverPhone?:string;lat:number;lng:number;status?:string;type?:string;zone?:string}>).map(a => ({
  id: a.id, label: a.label || a.id, vehicleNumber: a.vehicleNumber || 'DEMO',
  driver: a.driver || 'Synthetic demo driver', driverPhone: a.driverPhone || 'DEMO',
  type: a.type === 'ALS' ? 'Advanced Life Support (ALS)' : a.type === 'BLS' ? 'Basic Life Support (BLS)' : 'Patient Transport',
  status: a.status === 'Available' ? 'Available' : a.status === 'Offline' ? 'Offline' : 'On assignment',
  lat: a.lat, lng: a.lng, zone: a.zone || 'Bengaluru demo zone',
}))
function MapCenterController({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom())
  }, [center, map])
  return null
}

const navLinks = [
  ['/control-room', '▦', 'Control Room'],
  ['/delivery-patrol', '🚑', 'Delivery Patrol'],
  ['/hospitals', '✚', 'Hospitals'],
  ['/live-tracking', '⌖', 'Live Tracking'],
  ['/alerts', '♧', 'Alerts'],
]

export function ControlShell({
  children,
  title = 'Control Room',
  subtitle = 'Emergency Operations Command & Live Ambulance Dispatch',
}: {
  children: React.ReactNode
  title?: string
  subtitle?: string
}) {
  const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected')
  const [clock, setClock] = useState(new Date())
  const [unreadAlerts, setUnreadAlerts] = useState(emergencyStore.getUnacknowledgedIds().length)
  useEffect(() => {
    const unsubscribe = subscribeConnectionState(setConnectionState)
    const unsubscribeStore = emergencyStore.subscribe(() => setUnreadAlerts(emergencyStore.getUnacknowledgedIds().length))
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => { unsubscribe(); unsubscribeStore(); window.clearInterval(timer) }
  }, [])
  return (
    <div className="cr-app">
      <aside className="cr-sidebar">
        <Link to="/" className="cr-logo">
          <Logo className="cr-logo-mark" />
          <span>
            AidFlow<small>EMERGENCY NETWORK</small>
          </span>
        </Link>
        <div className="cr-side-label">OPERATIONS WORKSPACE</div>
        <nav aria-label="Operations Navigation">
          {navLinks.map(([to, icon, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                'cr-nav ' + (isActive ? 'active' : '') + (to === '/control-room' ? ' cr-nav-highlight' : '')
              }
            >
              <span className="cr-nav-icon">{icon}</span>
              {label}
              {to === '/alerts' && unreadAlerts > 0 && <span className="cr-unread-badge" aria-label={`${unreadAlerts} unread alerts`}>{unreadAlerts}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="cr-side-bottom">
          <span className="cr-live-dot" /> Live Control Room Feed
          <small>College Demonstration Project · Simulated Dispatch & GPS</small>
        </div>
      </aside>

      <main className="cr-main">
        <div className="cr-content">
          <div className="cr-page-heading">
            <div>
              <div className="cr-eyebrow">AIDFLOW EMERGENCY COMMAND CENTER</div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <div className="cr-date-group">
              <span className={`cr-live-pill ${connectionState === 'connected' ? 'is-live' : 'is-reconnecting'}`} aria-live="polite">
                <i /> {connectionState === 'connected' ? 'LIVE' : 'RECONNECTING'}
              </span>
              <div className="cr-date">
                ◷ {clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {clock.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}

export default function ControlRoom() {
  const [emergencies, setEmergencies] = useState<EmergencyRecord[]>([])
  const [fleet, setFleet] = useState<AmbulanceUnit[]>([])
  const [filter, setFilter] = useState<string>('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [mapCenter, setMapCenter] = useState<[number, number]>([22.5, 79])
  const backendSeenIds = useRef<Set<string>>(new Set())

  // Modals & Drawers state
  const [selectedEmergency, setSelectedEmergency] = useState<EmergencyRecord | null>(null)
  const [assigningEmergency, setAssigningEmergency] = useState<EmergencyRecord | null>(null)

  // Simulation timer for animated ambulance movement demo
  const [simulatingCaseId, setSimulatingCaseId] = useState<string | null>(null)
  const [simProgress, setSimProgress] = useState<number>(0)
  const simIntervalRef = useRef<number | null>(null)

  // Sync state with emergencyStore
  const loadState = () => {
    setEmergencies(emergencyStore.getEmergencies())
    {
      const liveFleet = emergencyStore.getFleet()
      const liveIds = new Set(liveFleet.map(unit => unit.id))
      setFleet([...liveFleet, ...syntheticFleet.filter(unit => !liveIds.has(unit.id))])
    }
  }

  useEffect(() => {
    loadState()
    const unsubscribe = emergencyStore.subscribe(loadState)

    // Fetch real backend emergencies
    api.listControlRoomCases().then((backendCases) => {
      const records = backendCases.map(emergencyCaseToRecord)
      backendSeenIds.current = new Set(records.map((record) => record.id))
      setEmergencies(records)
    }).catch((e) => console.debug('Backend fetch in ControlRoom:', e))

    // Socket events are the fast path. Polling is a recovery path for a temporarily
    // disconnected control-room tab so new emergencies still appear and alert.
    const recoveryPoll = window.setInterval(() => {
      api.listControlRoomCases().then((backendCases) => {
        const records = backendCases.map(emergencyCaseToRecord)
        for (const record of records) {
          if (!backendSeenIds.current.has(record.id)) {
            backendSeenIds.current.add(record.id)
            emergencyStore.ingestBackendEmergency(record)
          }
        }
        setEmergencies(records)
      }).catch((e) => console.debug('Control Room recovery refresh:', e))
    }, 7000)

    // Real-time Socket.IO subscriptions for live map & card updates
    const unsubCreated = onSocketEvent('case:created', (data) => {
      const rec = emergencyCaseToRecord(data.emergency)
      backendSeenIds.current.add(rec.id)
      emergencyStore.ingestBackendEmergency(rec)
      setEmergencies((prev) => [rec, ...prev.filter((p) => p.id !== rec.id)])
    }, null)

    const unsubAlert = onSocketEvent('alert:new', (alert) => {
      if (alert.emergencyId) {
        api.getControlRoomCase(alert.emergencyId).then((c) => {
          const rec = emergencyCaseToRecord(c)
          backendSeenIds.current.add(rec.id)
          emergencyStore.ingestBackendEmergency(rec)
          setEmergencies((prev) => [rec, ...prev.filter((p) => p.id !== rec.id)])
        }).catch((e) => console.debug('Could not hydrate alert case:', e))
      }
    }, null)

    const unsubConnection = subscribeConnectionState((state) => {
      if (state === 'connected') {
        api.listControlRoomCases().then((items) => {
          const records = items.map(emergencyCaseToRecord)
          backendSeenIds.current = new Set(records.map((record) => record.id))
          setEmergencies(records)
        }).catch((e) => console.debug('Reconnect refresh failed:', e))
      }
    })

    const unsubStatus = onSocketEvent('case:status', (data) => {
      api.getControlRoomCase(data.caseId).then((c) => {
        const rec = emergencyCaseToRecord(c)
        setEmergencies((prev) => [rec, ...prev.filter((p) => p.id !== rec.id)])
      }).catch((e) => console.debug(e))
    }, null)

    return () => {
      window.clearInterval(recoveryPoll)
      unsubscribe()
      unsubCreated()
      unsubAlert()
      unsubStatus()
      unsubConnection()
    }
  }, [])

  // Top KPIs
  const counts = useMemo(() => {
    const total = emergencies.length
    const pending = emergencies.filter((e) => e.status === 'NEW' || e.status === 'ACKNOWLEDGED').length
    const critical = emergencies.filter((e) => e.severity === 'Critical' && e.status !== 'COMPLETED').length
    const ambAvailable = fleet.filter((a) => a.status === 'Available').length
    const ambAssigned = fleet.filter((a) => a.status === 'On assignment').length
    const hospitalsCount = (hospitalDirectory as unknown[]).length
    return { total, pending, critical, ambAvailable, ambAssigned, hospitalsCount }
  }, [emergencies, fleet])

  // Filtered emergency list
  const filteredEmergencies = useMemo(() => {
    return emergencies.filter((item) => {
      const matchFilter =
        filter === 'All'
          ? true
          : filter === 'Critical'
            ? item.severity === 'Critical'
            : item.status.toUpperCase() === filter.toUpperCase()

      const matchSearch =
        !searchQuery ||
        item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.typeLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.patient.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.caller.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.location.address.toLowerCase().includes(searchQuery.toLowerCase())

      return matchFilter && matchSearch
    })
  }, [emergencies, filter, searchQuery])

  // Quick Action: Focus map on emergency
  const handleFocusOnMap = (record: EmergencyRecord) => {
    setMapCenter([record.location.lat, record.location.lng])
    const mapElement = document.getElementById('control-room-map')
    if (mapElement) {
      mapElement.scrollIntoView({ behavior: 'smooth' })
    }
  }

  // Quick Action: Assign Ambulance
  const handleOpenAssignModal = (record: EmergencyRecord) => {
    setAssigningEmergency(record)
  }

  const handleConfirmAssignment = (emergencyId: string, ambulanceId: string) => {
    emergencyStore.assignAmbulanceToEmergency(emergencyId, ambulanceId)
    setAssigningEmergency(null)
    loadState()
  }

  // Quick Action: Status update
  const handleStatusChange = (id: string, newStatus: EmergencyStatus) => {
    emergencyStore.updateEmergencyStatus(
      id,
      newStatus,
      `Status updated to ${newStatus} by Control Room Officer`
    )
    loadState()
  }

  // Demonstration: Simulated Ambulance Movement
  const startAmbulanceSimulation = (record: EmergencyRecord) => {
    if (!record.assignedAmbulance) return
    setSimulatingCaseId(record.id)
    setSimProgress(0)

    if (simIntervalRef.current) clearInterval(simIntervalRef.current)

    // Smoothly step 0% -> 100% over 15 seconds
    simIntervalRef.current = window.setInterval(() => {
      setSimProgress((prev) => {
        if (prev >= 100) {
          if (simIntervalRef.current) clearInterval(simIntervalRef.current)
          handleStatusChange(record.id, 'PATIENT PICKED UP')
          return 100
        }
        return prev + 10
      })
    }, 1500)
  }

  const stopAmbulanceSimulation = () => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current)
    setSimulatingCaseId(null)
    setSimProgress(0)
  }

  // Demo generator: quickly create an incoming emergency


  return (
    <ControlShell>
      {/* Compact WhatsApp-style notification for each incoming emergency */}
      <ControlRoomAlertToast
        onViewDetails={(rec) => setSelectedEmergency(rec)}
      />

      {/* Top Banner & Demo Controls Bar */}
      <div className="cr-demo-bar">
        <div className="cr-demo-info">
          <span className="demo-chip">ACADEMIC DEMO PLATFORM</span>
          <span className="demo-text">
            Monitor incoming reports, coordinate ambulances, and update case progress.
          </span>
        </div>
        <div className="cr-demo-btns">
        </div>
      </div>

      {/* 6 Key Operational Metric Cards */}
      <section className="cr-metrics-grid">
        <div className="cr-metric-card red-glow">
          <div className="metric-icon mint">🚨</div>
          <div className="metric-content">
            <span>Critical Emergencies</span>
            <strong>{counts.critical}</strong>
            <small>High severity incidents</small>
          </div>
        </div>

        <div className="cr-metric-card amber-glow">
          <div className="metric-icon amber">◷</div>
          <div className="metric-content">
            <span>Pending Dispatch</span>
            <strong>{counts.pending}</strong>
            <small>New &amp; acknowledged calls</small>
          </div>
        </div>

        <div className="cr-metric-card">
          <div className="metric-icon blue">▤</div>
          <div className="metric-content">
            <span>Total Emergencies</span>
            <strong>{counts.total}</strong>
            <small>Registered case register</small>
          </div>
        </div>

        <div className="cr-metric-card green-glow">
          <div className="metric-icon green">🚑</div>
          <div className="metric-content">
            <span>Available Ambulances</span>
            <strong>{counts.ambAvailable}</strong>
            <small>Ready in demo fleet ({fleet.length} total)</small>
          </div>
        </div>

        <div className="cr-metric-card">
          <div className="metric-icon amber">⚡</div>
          <div className="metric-content">
            <span>Ambulances Assigned</span>
            <strong>{counts.ambAssigned}</strong>
            <small>Active in transit / response</small>
          </div>
        </div>

        <div className="cr-metric-card">
          <div className="metric-icon blue">✚</div>
          <div className="metric-content">
            <span>Hospital Directory</span>
            <strong>{counts.hospitalsCount}</strong>
            <small>Mapped facilities in database</small>
          </div>
        </div>
      </section>

      {/* Live Map Panel with Patient Pins, Ambulance Fleet, and Route Lines */}
      <section className="cr-panel control-map-panel" id="control-room-map">
        <div className="hospital-list-head">
          <div>
            <h2>Live Emergency Incident &amp; Ambulance Fleet Map</h2>
            <p>
              India-wide satellite map showing every hospital directory record, all 300 demo ambulance units, and reported incidents.
            </p>
          </div>
          <div className="map-badge-group">
            <span className="cr-live-pill">
              <i /> SATELLITE &amp; FLEET RADAR
            </span>
          </div>
        </div>

        <div className="aidflow-map-wrap" style={{ height: '420px' }}>
          <MapContainer
            center={[22.5, 79]}
            zoom={4}
            scrollWheelZoom={true}
            className="aidflow-map"
          >
            <TileLayer
              attribution='Imagery &copy; Esri, Maxar, Earthstar Geographics'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
            <MapCenterController center={mapCenter} />

            {/* Emergency Incident Markers */}
            {emergencies.map((emg) => (
              <Marker
                key={emg.id}
                position={[emg.location.lat, emg.location.lng]}
                icon={emergencyMarkerIcon(emg.severity)}
              >
                <Popup>
                  <div className="map-popup-card">
                    <span className={`popup-sev ${emg.severity.toLowerCase()}`}>
                      {emg.severity.toUpperCase()}
                    </span>
                    <strong>{emg.id} · {emg.typeLabel}</strong>
                    <p>📍 {emg.location.address}</p>
                    <p>👤 Patient: {emg.patient.name}</p>
                    <p>Status: <b>{emg.status}</b></p>
                    {emg.assignedAmbulance && (
                      <p className="popup-amb">🚑 Assigned: {emg.assignedAmbulance.label}</p>
                    )}
                    <button
                      type="button"
                      className="popup-btn"
                      onClick={() => setSelectedEmergency(emg)}
                    >
                      View Incident Details
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Fleet Ambulance Markers */}
            {fleet.map((amb) => {
              // If simulating movement towards an emergency, interpolate coords
              let curLat = amb.lat
              let curLng = amb.lng
              const activeSimEmg = emergencies.find(
                (e) => e.assignedAmbulance?.id === amb.id && e.id === simulatingCaseId
              )
              if (activeSimEmg && simProgress > 0) {
                const ratio = simProgress / 100
                curLat = amb.lat + (activeSimEmg.location.lat - amb.lat) * ratio
                curLng = amb.lng + (activeSimEmg.location.lng - amb.lng) * ratio
              }

              return (
                <Marker
                  key={amb.id}
                  position={[curLat, curLng]}
                  icon={ambulanceMarkerIcon(amb.status)}
                >
                  <Popup>
                    <div className="map-popup-card map-directory-popup">
                      <span className="popup-hosp-tag">🚑 AMBULANCE UNIT</span><strong>{amb.label}</strong>
                      <div className="map-popup-facts"><span><b>Vehicle</b>{amb.vehicleNumber}</span><span><b>Driver</b>{amb.driver}</span><span><b>Contact</b>{amb.driverPhone || 'Not listed'}</span><span><b>Unit type</b>{amb.type}</span><span><b>Status</b>{amb.status}</span><span><b>Zone</b>{amb.zone || 'Not listed'}</span><span><b>Coordinates</b>{curLat.toFixed(5)}, {curLng.toFixed(5)}</span></div>
                      {activeSimEmg && (
                        <p className="popup-sim-note">
                          ⚡ Simulated Movement: {simProgress}% en-route
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              )
            })}

            {/* Route Polyline connecting assigned ambulances to their patient */}
            {emergencies
              .filter((e) => e.assignedAmbulance && e.status !== 'COMPLETED' && e.status !== 'CANCELLED')
              .map((e) => {
                const amb = e.assignedAmbulance!
                return (
                  <Polyline
                    key={`route-${e.id}`}
                    positions={[
                      [amb.lat, amb.lng],
                      [e.location.lat, e.location.lng],
                    ]}
                    pathOptions={{
                      color: e.severity === 'Critical' ? '#e11d2e' : '#38bdf8',
                      weight: 4,
                      dashArray: '8, 8',
                    }}
                  />
                )
              })}

            {/* Every geocoded hospital record from the supplied national hospital directory */}
            {directoryHospitalPins.map((h) => {
              const row = hospitalById.get(h.id)
              return <CircleMarker key={`directory-hospital-${h.id}`} center={[h.lat,h.lng]} radius={5} renderer={hospitalCanvasRenderer} pathOptions={{color:'#082f49',weight:2,fillColor:'#45d6c5',fillOpacity:.95}}>
                <Popup><div className="map-popup-card map-directory-popup"><span className="popup-hosp-tag">✚ HOSPITAL DIRECTORY</span><strong>{h.name}</strong><p>{h.address || 'Address not listed'}</p><div className="map-popup-facts"><span><b>District</b>{row?.district || 'Not listed'}</span><span><b>State</b>{row?.state || 'Not listed'}</span><span><b>Phone</b>{row?.phone || 'Not listed'}</span><span><b>Beds</b>{row?.beds ?? 'Not reported'}</span><span><b>ICU beds</b>{row?.icuBeds ?? 'Not reported'}</span><span><b>Specialties</b>{row?.specialties || 'Not listed'}</span></div><p><a href={`https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`} target="_blank" rel="noreferrer">Get directions ↗</a></p></div></Popup>
              </CircleMarker>
            })}
          </MapContainer>
        </div>

        <div className="hospital-map-legend">
          <span>
            <i className="legend-hospital">✚</i> Hospital Facility
          </span>
          <span>
            <i className="legend-ambulance">🚑</i> Ambulance Unit
          </span>
          <span>
            <i style={{ background: '#e11d2e', color: '#fff' }}>🚨</i> Critical Incident
          </span>
          <span>
            <i style={{ background: '#f59e0b', color: '#fff' }}>⚠️</i> High / Moderate Incident
          </span>
          <span>
            <span style={{ borderBottom: '2px dashed #38bdf8', width: '22px', display: 'inline-block' }} /> Dispatch Route
          </span>
          <small>{directoryHospitalPins.length.toLocaleString('en-IN')} hospitals · {fleet.length} ambulances · directory/demo coordinates</small>
        </div>
      </section>

      {/* Simulated Ambulance Movement Demo Banner (if active) */}
      {simulatingCaseId && (
        <div className="cr-sim-banner">
          <div className="sim-header">
            <span className="sim-pulse">⚡</span>
            <div>
              <strong>SIMULATED AMBULANCE MOVEMENT IN PROGRESS (DEMO MODE)</strong>
              <p>
                Demonstrating GPS vehicle progression towards patient for Case <b>{simulatingCaseId}</b>.
              </p>
            </div>
          </div>
          <div className="sim-progress-box">
            <div className="sim-bar-wrap">
              <div className="sim-bar-fill" style={{ width: `${simProgress}%` }} />
            </div>
            <span className="sim-pct">{simProgress}% Complete</span>
            <button type="button" className="sim-stop-btn" onClick={stopAmbulanceSimulation}>
              Stop Demo Simulation
            </button>
          </div>
        </div>
      )}

      {/* Live Emergency Queue Section */}
      <div className="cr-section-head">
        <div>
          <h2>Active Emergency Queue &amp; Dispatch Register</h2>
          <p>
            Real-time feed of all registered calls. Update statuses, assign ambulances, and track patient journeys.
          </p>
        </div>
        <div className="cr-filter-search">
          <input
            type="text"
            className="cr-search-box"
            placeholder="Search by ID, patient, type, or address…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <section className="cr-panel">
        {/* Status Filter Tabs */}
        <div className="cr-tabs">
          {[
            'All',
            'NEW',
            'ACKNOWLEDGED',
            'AMBULANCE ASSIGNED',
            'DISPATCHED',
            'PATIENT PICKED UP',
            'COMPLETED',
            'Critical',
          ].map((tabName) => {
            const count =
              tabName === 'All'
                ? emergencies.length
                : tabName === 'Critical'
                  ? counts.critical
                  : emergencies.filter((e) => e.status.toUpperCase() === tabName.toUpperCase()).length

            return (
              <button
                key={tabName}
                className={filter === tabName ? 'selected' : ''}
                onClick={() => setFilter(tabName)}
              >
                {tabName}
                <span>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Table Header */}
        <div className="cr-table-head queue-head">
          <span>CASE / INCIDENT</span>
          <span>TIME REPORTED</span>
          <span>PATIENT &amp; LOCATION</span>
          <span>SEVERITY</span>
          <span>ASSIGNED FLEET</span>
          <span>WORKFLOW STATUS</span>
          <span>ACTIONS</span>
        </div>

        {/* Table Rows */}
        {filteredEmergencies.map((r) => (
          <article className="cr-report-row queue-row" key={r.id}>
            {/* Case & Type */}
            <div className="cr-case">
              <i className={`case-line ${r.status.toLowerCase().replace(/\s+/g, '-')}`} />
              <div>
                <strong>{r.id}</strong>
                <span>
                  {r.typeEmoji} {r.typeLabel}
                </span>
              </div>
            </div>

            {/* Time */}
            <div className="cr-time">
              ◷ {r.timeString}
              <small>{new Date(r.createdAt).toLocaleDateString('en-IN')}</small>
            </div>

            {/* Location & Patient */}
            <div className="cr-location">
              <strong>{r.patient.name}</strong>
              <small title={r.location.address}>📍 {r.location.address}</small>
            </div>

            {/* Severity */}
            <div>
              <span className={`cr-priority ${r.severity.toLowerCase()}`}>
                {r.severity}
              </span>
            </div>

            {/* Assigned Fleet Unit */}
            <div className="cr-assigned-unit">
              {r.assignedAmbulance ? (
                <div className="unit-badge">
                  <span>🚑 {r.assignedAmbulance.id}</span>
                  <small>{r.assignedAmbulance.driver}</small>
                </div>
              ) : (
                <button
                  type="button"
                  className="quick-assign-btn"
                  onClick={() => handleOpenAssignModal(r)}
                >
                  + Assign Unit
                </button>
              )}
            </div>

            {/* Workflow Status Dropdown */}
            <div className="cr-status-actions">
              <span className={`cr-status ${r.status.toLowerCase().replace(/\s+/g, '-')}`}>
                <i />
                {r.status}
              </span>
              <select
                aria-label={`Update status for ${r.id}`}
                value={r.status}
                onChange={(e) => handleStatusChange(r.id, e.target.value as EmergencyStatus)}
              >
                <option value="NEW">NEW</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="AMBULANCE ASSIGNED">AMBULANCE ASSIGNED</option>
                <option value="DISPATCHED">DISPATCHED</option>
                <option value="PATIENT PICKED UP">PATIENT PICKED UP</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>

            {/* Row Actions */}
            <div className="cr-row-actions">
              <button
                type="button"
                className="row-btn map-btn"
                title="Focus map on this incident"
                onClick={() => handleFocusOnMap(r)}
              >
                🗺️
              </button>
              <button
                type="button"
                className="row-btn details-btn"
                title="View full emergency details"
                onClick={() => setSelectedEmergency(r)}
              >
                Inspect ↗
              </button>
            </div>
          </article>
        ))}

        {filteredEmergencies.length === 0 && (
          <div className="cr-empty">
            No emergency reports found matching the selected filter.
          </div>
        )}

        <div className="cr-panel-foot">
          Showing {filteredEmergencies.length} of {emergencies.length} reports
          <span>All records synchronised in real-time across browser instances.</span>
        </div>
      </section>

      {/* Ambulance Assignment Modal */}
      {assigningEmergency && (
        <div className="af-custom-modal-backdrop" role="dialog" aria-modal="true">
          <div className="af-custom-modal assign-modal">
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">AMBULANCE DISPATCH ASSIGNMENT</span>
                <h3>Assign Unit to Case {assigningEmergency.id}</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setAssigningEmergency(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="assign-case-summary">
                <div>
                  <strong>{assigningEmergency.typeLabel} ({assigningEmergency.severity})</strong>
                  <p>📍 {assigningEmergency.location.address}</p>
                </div>
                <div>
                  <span>Patient:</span>
                  <strong>{assigningEmergency.patient.name}</strong>
                </div>
              </div>

              {/* Recommended unit badge */}
              {(() => {
                const rec = findRecommendedAmbulance(
                  fleet,
                  assigningEmergency.location.lat,
                  assigningEmergency.location.lng,
                  assigningEmergency.severity
                )
                if (!rec) return null
                const dist = calculateDistanceKm(
                  rec.lat,
                  rec.lng,
                  assigningEmergency.location.lat,
                  assigningEmergency.location.lng
                )
                return (
                  <div className="rec-ambulance-banner">
                    <span className="rec-icon">★</span>
                    <div>
                      <strong>RECOMMENDED DISPATCH UNIT: {rec.label}</strong>
                      <p>
                        Selected for {rec.type} capability and closest proximity ({dist.toFixed(1)} km, Est. ETA ~
                        {Math.max(2, Math.round((dist / 35) * 60))} min).
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rec-assign-btn"
                      onClick={() => handleConfirmAssignment(assigningEmergency.id, rec.id)}
                    >
                      Assign Recommended Unit
                    </button>
                  </div>
                )
              })()}

              <h4>Available Fleet Units</h4>
              <div className="fleet-list">
                {fleet.map((unit) => {
                  const dist = calculateDistanceKm(
                    unit.lat,
                    unit.lng,
                    assigningEmergency.location.lat,
                    assigningEmergency.location.lng
                  )
                  const eta = Math.max(2, Math.round((dist / 35) * 60))
                  const isAvailable = unit.status === 'Available'

                  return (
                    <div
                      key={unit.id}
                      className={`fleet-card ${!isAvailable ? 'disabled' : ''}`}
                    >
                      <div className="fleet-card-icon">🚑</div>
                      <div className="fleet-card-info">
                        <strong>{unit.label}</strong>
                        <small>{unit.vehicleNumber} · Driver: {unit.driver}</small>
                        <div className="fleet-meta-tags">
                          <span className="fleet-type-tag">{unit.type}</span>
                          <span className={`fleet-status-tag ${unit.status.toLowerCase()}`}>
                            {unit.status}
                          </span>
                          <span className="fleet-dist-tag">📍 {dist.toFixed(1)} km (~{eta} min)</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="fleet-assign-action"
                        disabled={!isAvailable}
                        onClick={() => handleConfirmAssignment(assigningEmergency.id, unit.id)}
                      >
                        {isAvailable ? 'Assign Unit' : unit.status}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Detail Inspection Modal */}
      {selectedEmergency && (
        <div className="af-custom-modal-backdrop" role="dialog" aria-modal="true">
          <div className="af-custom-modal details-modal">
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">EMERGENCY CASE DOSSIER</span>
                <h3>
                  {selectedEmergency.id} · {selectedEmergency.typeLabel}
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedEmergency(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body dossier-body">
              <div className="dossier-grid">
                <div className="dossier-card">
                  <h4>Caller &amp; Reporter</h4>
                  <p><b>Name:</b> {selectedEmergency.caller.name}</p>
                  <p><b>Contact:</b> {selectedEmergency.caller.phone}</p>
                  <p><b>Relationship:</b> {selectedEmergency.caller.relationship}</p>
                  <p><b>Time Registered:</b> {selectedEmergency.timeString}</p>
                </div>

                <div className="dossier-card">
                  <h4>Patient Details</h4>
                  <p><b>Patient Name:</b> {selectedEmergency.patient.name}</p>
                  <p><b>Age / Gender:</b> {selectedEmergency.patient.age || 'N/A'} / {selectedEmergency.patient.gender}</p>
                  <p><b>Patient Count:</b> {selectedEmergency.patient.count}</p>
                  <p><b>Current Status:</b> <span className={`cr-status ${selectedEmergency.status.toLowerCase()}`}>{selectedEmergency.status}</span></p>
                </div>
              </div>

              <div className="dossier-card">
                <h4>Clinical &amp; Incident Notes</h4>
                <p className="dossier-notes">{selectedEmergency.medicalNotes || 'No specific notes recorded.'}</p>
                {selectedEmergency.symptoms.length > 0 && (
                  <div className="dossier-tags">
                    <b>Reported Symptoms:</b>
                    {selectedEmergency.symptoms.map((s) => (
                      <span key={s} className="dossier-tag">• {s}</span>
                    ))}
                  </div>
                )}
                {selectedEmergency.specialAssistance.length > 0 && (
                  <div className="dossier-tags">
                    <b>Special Assistance:</b>
                    {selectedEmergency.specialAssistance.map((a) => (
                      <span key={a} className="dossier-tag alert">⚠️ {a}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="dossier-grid">
                <div className="dossier-card">
                  <h4>Incident Location</h4>
                  <p><b>Address:</b> {selectedEmergency.location.address}</p>
                  <p><b>Coordinates:</b> {selectedEmergency.location.lat.toFixed(5)}, {selectedEmergency.location.lng.toFixed(5)}</p>
                  <a
                    href={`https://www.google.com/maps?q=${selectedEmergency.location.lat},${selectedEmergency.location.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="dossier-link"
                  >
                    Open Google Maps ↗
                  </a>
                </div>

                <div className="dossier-card">
                  <h4>Hospital Destination</h4>
                  {selectedEmergency.hospital ? (
                    <>
                      <p><b>Hospital:</b> {selectedEmergency.hospital.name}</p>
                      <p><b>Distance:</b> {selectedEmergency.hospital.distanceKm} km</p>
                      <p><b>Reason:</b> {selectedEmergency.hospital.reason}</p>
                      <p><b>Emergency Ward Phone:</b> {selectedEmergency.hospital.phone}</p>
                    </>
                  ) : (
                    <p>No hospital allocated yet.</p>
                  )}
                </div>
              </div>

              {/* Assigned Ambulance Info & Simulated Movement Button */}
              <div className="dossier-card amb-dispatch-card">
                <h4>Ambulance Dispatch Coordination</h4>
                {selectedEmergency.assignedAmbulance ? (
                  <div className="assigned-amb-box">
                    <div>
                      <strong>{selectedEmergency.assignedAmbulance.label}</strong>
                      <p>Driver: {selectedEmergency.assignedAmbulance.driver} ({selectedEmergency.assignedAmbulance.driverPhone})</p>
                      <p>Vehicle: {selectedEmergency.assignedAmbulance.vehicleNumber} · Type: {selectedEmergency.assignedAmbulance.type}</p>
                    </div>
                    <div className="assigned-amb-actions">
                      <button
                        type="button"
                        className="sim-start-btn"
                        onClick={() => {
                          setSelectedEmergency(null)
                          startAmbulanceSimulation(selectedEmergency)
                        }}
                      >
                        ⚡ Start Simulated Movement (Demo)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="no-amb-box">
                    <p>No ambulance unit has been assigned to this emergency.</p>
                    <button
                      type="button"
                      className="cr-primary"
                      onClick={() => {
                        const target = selectedEmergency
                        setSelectedEmergency(null)
                        setAssigningEmergency(target)
                      }}
                    >
                      Assign Ambulance Now
                    </button>
                  </div>
                )}
              </div>

              {/* Status Update History */}
              <div className="dossier-card">
                <h4>Status Timeline History</h4>
                <div className="history-timeline">
                  {selectedEmergency.history.map((h, i) => (
                    <div key={i} className="timeline-item">
                      <span className="timeline-dot" />
                      <div>
                        <strong>{h.status}</strong>
                        <small>{new Date(h.at).toLocaleTimeString('en-IN')} — {h.note || 'Status change confirmed'}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .cr-demo-bar {
          background: #0f1c30;
          border: 1px solid #1f3452;
          border-radius: 12px;
          padding: 14px 20px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 14px;
        }
        .cr-demo-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .demo-chip {
          background: #172f4d;
          color: #38bdf8;
          border: 1px solid #234975;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.5px;
        }
        .demo-text {
          font-size: 12px;
          color: #94a3b8;
        }
        .cr-demo-btns {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .cr-metrics-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 12px;
        }
        @media (max-width: 1200px) {
          .cr-metrics-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 680px) {
          .cr-metrics-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .cr-metric-card {
          background: #0d1728;
          border: 1px solid #1c2e47;
          border-radius: 12px;
          padding: 16px 14px;
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }
        .cr-metric-card.red-glow {
          border-color: rgba(225, 29, 46, 0.45);
        }
        .cr-metric-card.amber-glow {
          border-color: rgba(245, 158, 11, 0.4);
        }
        .cr-metric-card.green-glow {
          border-color: rgba(34, 197, 94, 0.4);
        }
        .metric-content strong {
          display: block;
          font-size: 26px;
          color: #ffffff;
          line-height: 1.2;
          margin: 2px 0 4px;
        }
        .metric-content span {
          display: block;
          font-size: 11px;
          color: #94a3b8;
          font-weight: 600;
        }
        .metric-content small {
          font-size: 10px;
          color: #64748b;
        }
        .cr-sim-banner {
          background: #1e130c;
          border: 2px solid #f59e0b;
          border-radius: 12px;
          padding: 16px 20px;
          margin-bottom: 22px;
          animation: glowSim 1.5s infinite alternate;
        }
        @keyframes glowSim {
          from { box-shadow: 0 0 10px rgba(245, 158, 11, 0.3); }
          to { box-shadow: 0 0 25px rgba(245, 158, 11, 0.6); }
        }
        .sim-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .sim-pulse {
          font-size: 24px;
        }
        .sim-header strong {
          color: #fef08a;
          font-size: 13px;
          letter-spacing: 0.5px;
        }
        .sim-header p {
          color: #cbd5e1;
          font-size: 12px;
          margin: 2px 0 0;
        }
        .sim-progress-box {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .sim-bar-wrap {
          flex: 1;
          height: 10px;
          background: #332014;
          border-radius: 20px;
          overflow: hidden;
        }
        .sim-bar-fill {
          height: 100%;
          background: #f59e0b;
          transition: width 0.4s ease-out;
        }
        .sim-pct {
          font-size: 13px;
          font-weight: 800;
          color: #fef08a;
          min-width: 80px;
        }
        .sim-stop-btn {
          background: #78350f;
          border: 1px solid #b45309;
          color: #fef08a;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }
        .cr-filter-search {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cr-search-box {
          background: #0d1728;
          border: 1px solid #1c2e47;
          border-radius: 8px;
          padding: 10px 14px;
          color: #f1f5f9;
          font-size: 12px;
          min-width: 280px;
          outline: none;
        }
        .cr-search-box:focus {
          border-color: #38bdf8;
        }
        .queue-head, .queue-row {
          grid-template-columns: 1.3fr 0.8fr 1.4fr 0.8fr 1fr 1.2fr 0.8fr !important;
          gap: 12px;
        }
        @media (max-width: 1050px) {
          .queue-head {
            display: none !important;
          }
          .queue-row {
            grid-template-columns: 1fr 1fr !important;
            gap: 10px;
          }
        }
        .cr-assigned-unit .unit-badge {
          background: #11253d;
          border: 1px solid #1f4269;
          padding: 4px 8px;
          border-radius: 6px;
        }
        .cr-assigned-unit .unit-badge span {
          display: block;
          font-size: 11px;
          color: #7dd3fc;
          font-weight: 700;
        }
        .cr-assigned-unit .unit-badge small {
          font-size: 9px;
          color: #94a3b8;
        }
        .quick-assign-btn {
          background: #172a44;
          border: 1px dashed #38bdf8;
          color: #38bdf8;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
        }
        .quick-assign-btn:hover {
          background: #1e3a5f;
        }
        .cr-row-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .row-btn {
          border: 0;
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }
        .row-btn.map-btn {
          background: #10243b;
          color: #38bdf8;
          border: 1px solid #1d3e63;
        }
        .row-btn.details-btn {
          background: #17263b;
          color: #cbd5e1;
          border: 1px solid #283d5a;
        }
        .row-btn.details-btn:hover {
          color: #fff;
          background: #253956;
        }
        .af-custom-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(3, 7, 16, 0.85);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10001;
          padding: 20px;
        }
        .af-custom-modal {
          background: #0d1728;
          border: 1px solid #1f334f;
          border-radius: 16px;
          width: 100%;
          color: #f1f5f9;
          box-shadow: 0 25px 60px rgba(0,0,0,0.8);
          max-height: 88vh;
          display: flex;
          flex-direction: column;
        }
        .af-custom-modal.assign-modal {
          max-width: 680px;
        }
        .af-custom-modal.details-modal {
          max-width: 800px;
        }
        .modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid #1a2a40;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-eyebrow {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1px;
          color: #38bdf8;
        }
        .modal-header h3 {
          margin: 4px 0 0;
          font-size: 18px;
        }
        .modal-close-btn {
          background: transparent;
          border: 0;
          color: #94a3b8;
          font-size: 18px;
          cursor: pointer;
        }
        .modal-body {
          padding: 24px;
          overflow-y: auto;
        }
        .assign-case-summary {
          background: #111e33;
          border: 1px solid #1e334f;
          border-radius: 10px;
          padding: 14px;
          display: flex;
          justify-content: space-between;
          margin-bottom: 18px;
          font-size: 12px;
        }
        .rec-ambulance-banner {
          background: #0c2b42;
          border: 1px solid #0284c7;
          border-radius: 10px;
          padding: 14px;
          display: grid;
          grid-template-columns: 28px 1fr auto;
          gap: 12px;
          align-items: center;
          margin-bottom: 20px;
        }
        .rec-icon {
          font-size: 20px;
          color: #38bdf8;
        }
        .rec-ambulance-banner strong {
          color: #7dd3fc;
          font-size: 13px;
        }
        .rec-ambulance-banner p {
          color: #cbd5e1;
          font-size: 11px;
          margin: 2px 0 0;
        }
        .rec-assign-btn {
          background: #0284c7;
          color: #fff;
          border: 0;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
        }
        .fleet-list {
          display: grid;
          gap: 10px;
          margin-top: 10px;
        }
        .fleet-card {
          background: #111e33;
          border: 1px solid #1e334f;
          border-radius: 10px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .fleet-card.disabled {
          opacity: 0.5;
        }
        .fleet-card-icon {
          font-size: 24px;
        }
        .fleet-card-info {
          flex: 1;
        }
        .fleet-card-info strong {
          font-size: 14px;
          display: block;
        }
        .fleet-card-info small {
          color: #94a3b8;
          font-size: 11px;
        }
        .fleet-meta-tags {
          display: flex;
          gap: 8px;
          margin-top: 6px;
        }
        .fleet-type-tag, .fleet-status-tag, .fleet-dist-tag {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 4px;
        }
        .fleet-type-tag {
          background: #1e3a5f;
          color: #bfdbfe;
        }
        .fleet-status-tag.available {
          background: #064e3b;
          color: #a7f3d0;
        }
        .fleet-status-tag.on.assignment {
          background: #451a03;
          color: #fde68a;
        }
        .fleet-dist-tag {
          background: #172554;
          color: #93c5fd;
        }
        .fleet-assign-action {
          background: #1e293b;
          border: 1px solid #334155;
          color: #fff;
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }
        .fleet-assign-action:hover:not(:disabled) {
          background: #0284c7;
          border-color: #0284c7;
        }
        .dossier-body {
          display: grid;
          gap: 16px;
        }
        .dossier-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .dossier-card {
          background: #111e33;
          border: 1px solid #1e334f;
          border-radius: 10px;
          padding: 14px;
          font-size: 12px;
        }
        .dossier-card h4 {
          font-size: 13px;
          color: #38bdf8;
          margin-bottom: 8px;
          border-bottom: 1px solid #1d3350;
          padding-bottom: 4px;
        }
        .dossier-notes {
          color: #fef08a;
          line-height: 1.5;
        }
        .dossier-tags {
          margin-top: 8px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        .dossier-tag {
          background: #172a44;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 11px;
        }
        .dossier-tag.alert {
          background: #450a0a;
          color: #fca5a5;
        }
        .dossier-link {
          display: inline-block;
          margin-top: 8px;
          color: #38bdf8;
          font-size: 11px;
        }
        .assigned-amb-box {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .sim-start-btn {
          background: #f59e0b;
          color: #000;
          border: 0;
          padding: 9px 14px;
          border-radius: 8px;
          font-weight: 800;
          font-size: 12px;
          cursor: pointer;
        }
        .history-timeline {
          margin-top: 10px;
          display: grid;
          gap: 10px;
        }
        .timeline-item {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .timeline-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #38bdf8;
          margin-top: 4px;
        }
        .timeline-item strong {
          display: block;
          font-size: 12px;
          color: #fff;
        }
        .timeline-item small {
          font-size: 10px;
          color: #8fa3ba;
        }
        .map-popup-card {
          font-size: 12px;
          color: #0f172a;
          line-height: 1.4;
        }
        .map-popup-card strong {
          display: block;
          font-size: 13px;
          margin: 4px 0;
        }
        .popup-sev {
          font-size: 9px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 4px;
          color: #fff;
          display: inline-block;
        }
        .popup-sev.critical { background: #e11d2e; }
        .popup-sev.high { background: #f59e0b; }
        .popup-sev.moderate { background: #3b82f6; }
        .popup-btn {
          margin-top: 6px;
          background: #0284c7;
          color: #fff;
          border: 0;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          width: 100%;
        }
      `}</style>
    </ControlShell>
  )
}
