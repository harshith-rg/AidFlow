import { useCallback, useEffect, useState } from 'react'
import { ControlShell } from './ControlRoom'
import { emergencyStore, type AmbulanceUnit, type EmergencyRecord } from '../services/emergencyStore'
import { emergencyCaseToRecord } from '../services/caseAdapter'
import { api } from '../api/client'
import type { EmergencyCase } from '../types/contract'
import { getSocket } from '../realtime/socket'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './control-room.css'
import fleetDataset from '../data/bengaluru_ambulances_demo.json'

const emergencyPin = (severity: string) => L.divIcon({
  className: 'aidflow-emergency-pin',
  html: `<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:${severity === 'critical' ? '#dc2626' : severity === 'high' ? '#f97316' : '#eab308'};border:3px solid white;color:white;font-weight:900;box-shadow:0 2px 12px #0008">!</span>`,
  iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14],
})


const patrolAmbulancePin = L.divIcon({ className:'patrol-ambulance-pin', html:'<span>🚑</span>', iconSize:[28,28], iconAnchor:[14,14] })
const patrolHospitalPin = L.divIcon({ className:'patrol-hospital-pin', html:'<span>H</span>', iconSize:[24,24], iconAnchor:[12,12] })

const completeDemoFleet: AmbulanceUnit[] = (fleetDataset as Array<{id:string;label?:string;vehicleNumber?:string;driver?:string;driverPhone?:string;driverFirstName?:string;lat:number;lng:number;status?:string;type?:string;zone?:string;nearestHospitalName?:string}>).map((a, index) => ({
  id:a.id, label:a.label || a.id, vehicleNumber:a.vehicleNumber || `DEMO-${index+1}`,
  driver:a.driver || a.driverFirstName || `Demo Driver ${index+1}`,
  // Clearly non-callable contact placeholders for a student demonstration.
  driverPhone:`000-000-${String(((index+1)*7919)%10000).padStart(4,'0')}`,
  type:a.type === 'ALS' ? 'Advanced Life Support (ALS)' : a.type === 'BLS' ? 'Basic Life Support (BLS)' : 'Patient Transport',
  status:a.status === 'Offline' ? 'Offline' : a.status === 'On assignment' ? 'On assignment' : 'Available',
  lat:a.lat, lng:a.lng, zone:a.nearestHospitalName ? `Near ${a.nearestHospitalName}` : `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`,
}))

function SelectedCaseMap({ selected }: { selected: EmergencyCase | null }) {
  const map = useMap()
  useEffect(() => {
    if (selected?.pickup?.lat && selected?.pickup?.lng) {
      map.flyTo([selected.pickup.lat, selected.pickup.lng], 16, { duration: 0.8 })
    }
  }, [selected?.id, selected?.pickup?.lat, selected?.pickup?.lng, map])
  return null
}

export function LiveTracking() {
  const [cases, setCases] = useState<EmergencyCase[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetails, setSelectedDetails] = useState<EmergencyCase | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const rows = await api.listControlRoomCases()
      setCases(rows)
      setError('')
      setSelectedId(current => current && rows.some(row => row.id === current) ? current : rows[0]?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reported emergencies.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void refresh()
    const socket = getSocket(null)
    const onCreated = () => { void refresh() }
    const onStatus = () => { void refresh() }
    socket.on('case:created', onCreated)
    socket.on('case:status', onStatus)
    socket.on('connect', refresh)
    const timer = window.setInterval(() => { void refresh() }, 15000)
    return () => {
      socket.off('case:created', onCreated)
      socket.off('case:status', onStatus)
      socket.off('connect', refresh)
      window.clearInterval(timer)
    }
  }, [refresh])

  const selected = cases.find(item => item.id === selectedId) ?? null
  useEffect(() => {
    if (!selectedId) { setSelectedDetails(null); return }
    let active = true
    api.getControlRoomCase(selectedId).then(item => { if (active) setSelectedDetails(item) }).catch(() => { if (active) setSelectedDetails(selected) })
    return () => { active = false }
  }, [selectedId, selected?.createdAt])
  const detail = selectedDetails?.id === selectedId ? selectedDetails : selected
  const selectedAmbulance = selected?.ambulance ? completeDemoFleet.find(unit => unit.id === selected.ambulance?.id) : undefined
  const locatedCases = cases.filter(c => Number.isFinite(c.pickup?.lat) && Number.isFinite(c.pickup?.lng))
  const center: [number, number] = selected?.pickup ? [selected.pickup.lat, selected.pickup.lng] : locatedCases[0]?.pickup ? [locatedCases[0].pickup.lat, locatedCases[0].pickup.lng] : [12.9716, 77.5946]
  const activeCases = cases.filter(c => !['completed','cancelled'].includes(c.status)).length
  const assignedUnits = cases.filter(c => c.ambulance && !['completed','cancelled'].includes(c.status)).length
  const resolvedToday = cases.filter(c => c.status === 'completed' && new Date(c.createdAt).toDateString() === new Date().toDateString()).length
  const hospitalCount = new Set(cases.filter(c => c.hospital?.id).map(c => c.hospital?.id)).size

  return (
    <ControlShell title="Live Tracking" subtitle="Every emergency reported so far, with incident details and satellite imagery of its reported location.">
      <section className="cr-metrics cr-live-metrics">
        <div className="cr-metric"><span className="metric-icon mint">🚨</span><div><span>Active emergencies</span><strong>{activeCases}</strong><small>Open cases</small></div></div>
        <div className="cr-metric"><span className="metric-icon blue">🚑</span><div><span>Units assigned</span><strong>{assignedUnits}</strong><small>Linked to active cases</small></div></div>
        <div className="cr-metric"><span className="metric-icon green">✚</span><div><span>Hospitals notified</span><strong>{hospitalCount}</strong><small>Linked case records</small></div></div>
        <div className="cr-metric"><span className="metric-icon blue">✓</span><div><span>Resolved today</span><strong>{resolvedToday}</strong><small>Completed cases</small></div></div>
      </section>
      <div className="cr-section-head">
        <div><h2>Reported emergencies</h2><p>Live feed from the shared AidFlow backend. Select a report to inspect its location and details.</p></div>
        <span className="cr-live-pill"><i /> {cases.length} REPORTS</span>
      </div>
      {error && <div role="alert" className="cr-error-banner">{error}</div>}
      <div className="cr-bottom-grid" style={{ gridTemplateColumns: 'minmax(280px, 0.85fr) minmax(0, 1.6fr)', alignItems: 'start' }}>
        <section className="cr-panel" style={{ maxHeight: 720, overflowY: 'auto' }}>
          <div className="hospital-list-head"><div><h2>Emergency reports</h2><p>{loading ? 'Loading reports…' : `${cases.length} total reports received`}</p></div></div>
          {loading && <p style={{ padding: 18 }}>Loading reported emergencies…</p>}
          {!loading && cases.length === 0 && <div style={{ padding: 22 }}><h3>No emergencies reported yet</h3><p>New user reports will appear here automatically.</p></div>}
          {cases.map(c => (
            <button key={c.id} type="button" onClick={() => setSelectedId(c.id)} className={`cr-report-row cr-live-report-row ${selectedId === c.id ? 'is-selected' : ''}`}>
              <div className="cr-live-report-main">
                <span className="hospital-symbol report-symbol">{c.type === 'cardiac' ? '❤️' : c.type === 'accident' ? '🚗' : c.type === 'fire' ? '🔥' : '🚨'}</span>
                <div className="cr-live-report-copy"><strong>{c.id} <small>{c.severity.toUpperCase()}</small></strong><span>{c.type.replace(/_/g, ' ').toUpperCase()} · {c.reporterName || 'Caller details unavailable'}</span><p><b>Location:</b> {c.pickup.address || `GPS ${c.pickup.lat.toFixed(5)}, ${c.pickup.lng.toFixed(5)}`}</p><p><b>Ambulance:</b> {c.ambulance?.label || 'Awaiting assignment'}</p></div>
              </div>
              <div className="cr-live-report-status"><span className={'cr-status ' + (c.severity === 'critical' ? 'new' : 'info-blue')}><i />{c.severity.toUpperCase()}</span><strong>{c.status.replace(/_/g, ' ')}</strong><small>{new Date(c.createdAt).toLocaleString()}</small></div>
            </button>
          ))}
        </section>
        <section className="cr-panel control-map-panel">
          <div className="hospital-list-head"><div><h2>Incident satellite map</h2><p>{selected ? `Focused on ${selected.id} · ${selected.pickup.address || 'GPS coordinates'}` : 'Select a reported emergency to focus the map.'}</p></div><span className="cr-live-pill"><i /> SATELLITE</span></div>
          <div style={{ height: 470, width: '100%', borderRadius: 12, overflow: 'hidden' }}>
            <MapContainer center={center} zoom={selected ? 16 : 6} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
              <TileLayer attribution='Imagery © Esri, Maxar, Earthstar Geographics' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
              <SelectedCaseMap selected={selected} />
              {locatedCases.map(c => <Marker key={c.id} position={[c.pickup.lat, c.pickup.lng]} icon={emergencyPin(c.severity)} eventHandlers={{ click: () => setSelectedId(c.id) }}><Popup><strong>{c.id}</strong><br />{c.type} · {c.severity}<br />{c.reporterName}<br />{c.pickup.address || `${c.pickup.lat}, ${c.pickup.lng}`}</Popup></Marker>)}
              {selectedAmbulance && <Marker position={[selectedAmbulance.lat, selectedAmbulance.lng]} icon={patrolAmbulancePin}><Popup><strong>{selectedAmbulance.label}</strong><br />{selectedAmbulance.vehicleNumber}<br />Driver: {selectedAmbulance.driver}<br />Contact: {selectedAmbulance.driverPhone} (demo)</Popup></Marker>}
              {selected?.hospital?.lat != null && selected?.hospital?.lng != null && <Marker position={[selected.hospital.lat, selected.hospital.lng]} icon={patrolHospitalPin}><Popup><strong>{selected.hospital.name}</strong><br />Recommended hospital</Popup></Marker>}
            </MapContainer>
          </div>
          {detail ? <div className="incident-dossier">
            <header className="incident-dossier-head"><div><span className="cr-eyebrow">INCIDENT REPORT</span><h2>{detail.id}</h2><p>{detail.pickup.address || `GPS ${detail.pickup.lat.toFixed(5)}, ${detail.pickup.lng.toFixed(5)}`}</p></div><span className={'cr-status ' + (detail.severity === 'critical' ? 'new' : 'processing')}>{detail.severity.toUpperCase()}</span></header>
            <div className="incident-progress"><div className="incident-progress-step active"><b>01</b><span>Reported</span><small>{new Date(detail.createdAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</small></div><div className={'incident-progress-step '+(detail.ambulance?'active':'')}><b>02</b><span>Ambulance</span><small>{detail.ambulance ? 'Assigned' : 'Waiting'}</small></div><div className={'incident-progress-step '+(['reached_patient','heading_to_hospital','handed_over','completed'].includes(detail.status)?'active':'')}><b>03</b><span>En route</span><small>{detail.etaMinutes != null ? `${detail.etaMinutes} min ETA` : 'ETA unavailable'}</small></div><div className={'incident-progress-step '+(detail.status==='completed'?'active':'')}><b>04</b><span>At hospital</span><small>{detail.hospital?.name || 'Pending'}</small></div></div>
            <section className="incident-detail-section"><div className="incident-detail-title"><span>REPORT DETAILS</span><b>{detail.type.replace(/_/g,' ').toUpperCase()}</b></div><p className="incident-context">{detail.description || 'No special context provided by caller.'}</p><div className="incident-facts"><div><small>Patients</small><strong>1</strong></div><div><small>Conscious</small><strong>Not provided</strong></div><div><small>Breathing</small><strong>Not provided</strong></div><div><small>Reported by</small><strong>{detail.reporterName || 'Not provided'}</strong></div><div><small>Phone</small><strong>{detail.reporterPhone || 'Not provided'}</strong></div><div><small>Reported</small><strong>{new Date(detail.createdAt).toLocaleString('en-IN')}</strong></div></div></section>
            <section className="incident-detail-section"><div className="incident-detail-title"><span>RESPONSE STATUS</span><b>{detail.status.replace(/_/g,' ').toUpperCase()}</b></div><div className="incident-facts"><div><small>Ambulance</small><strong>{detail.ambulance?.label || 'Not assigned yet'}</strong></div><div><small>Vehicle</small><strong>{detail.ambulance?.vehicleNumber || 'Not assigned'}</strong></div><div><small>Driver</small><strong>{detail.ambulance?.driverFirstName || 'Pending'}</strong></div><div><small>Driver contact</small><strong>{selectedAmbulance?.driverPhone || 'Not assigned'}</strong></div><div><small>ETA</small><strong>{detail.etaMinutes != null ? `${detail.etaMinutes} min (estimate)` : 'Calculating…'}</strong></div><div><small>Recommended hospital</small><strong>{detail.hospital?.name || 'Pending recommendation'}</strong></div></div></section>
            <section className="incident-detail-section"><div className="incident-detail-title"><span>STATUS HISTORY</span></div>{detail.history?.length ? detail.history.map((h,i)=><p key={`${h.status}-${i}`} className="cr-card-copy">{new Date(h.at).toLocaleString('en-IN')} — {h.status.replace(/_/g,' ')}</p>) : <p className="cr-card-copy">No status updates recorded.</p>}</section>
          </div> : <div style={{ padding: 20 }}><p>Select a report to see its full information and zoom to its exact reported location.</p></div>}
        </section>
      </div>
    </ControlShell>
  )
}

export function DeliveryPatrol() {
  const [fleet, setFleet] = useState<AmbulanceUnit[]>(() => mergeFleet())

  useEffect(() => {
    const sync = () => setFleet(mergeFleet())
    return emergencyStore.subscribe(sync)
  }, [])

  function mergeFleet(): AmbulanceUnit[] {
    const saved = emergencyStore.getFleet()
    const savedById = new Map<string, AmbulanceUnit>(saved.map(unit => [unit.id, unit] as const))
    return completeDemoFleet.map(unit => ({ ...unit, ...(savedById.get(unit.id) || {}) }))
  }

  const updateStatus = (id: string, status: AmbulanceUnit['status']) => {
    const updated = fleet.map((u) => (u.id === id ? { ...u, status } : u))
    emergencyStore.saveFleet(updated)
  }

  const availableCount = fleet.filter((u) => u.status === 'Available').length

  return (
    <ControlShell
      title="Delivery Patrol"
      subtitle="Review every ambulance, its nearby landmark, GPS coordinates and readiness."
    >
      <div className="cr-section-head">
        <div>
          <h2>Ambulance fleet status</h2>
          <p>Interactive demo fleet. Status updates synchronize across all dashboards in real-time.</p>
        </div>
        <span className="cr-live-pill">{availableCount} AVAILABLE</span>
      </div>

      <section className="cr-panel">
        <div className="cr-table-head patrol-head">
          <span>UNIT ID &amp; DRIVER</span>
          <span>CURRENT LOCATION</span>
          <span>UNIT TYPE</span>
          <span>STATUS</span>
          <span>UPDATE STATUS</span>
        </div>
        {fleet.map((u) => (
          <div className="cr-report-row patrol-row" key={u.id}>
            <div className="cr-case">
              <span className="hospital-symbol patrol-vehicle-symbol">🚑</span>
              <div>
                <strong>{u.label}</strong>
                <span>{u.vehicleNumber} · Driver: {u.driver} · Contact: {u.driverPhone} (demo)</span>
              </div>
            </div>
            <div className="patrol-location"><strong>{u.zone}</strong><small>GPS {u.lat.toFixed(5)}, {u.lng.toFixed(5)}</small></div>
            <div>
              <span className="fleet-type-tag" style={{ fontSize: '11px', background: '#1e334d', color: '#7dd3fc', padding: '3px 8px', borderRadius: '4px' }}>
                {u.type}
              </span>
            </div>
            <div>
              <span
                className={
                  'cr-status ' +
                  (u.status === 'Available'
                    ? 'completed'
                    : u.status === 'Offline'
                      ? 'new'
                      : 'processing')
                }
              >
                <i />
                {u.status}
              </span>
            </div>
            <div>
              <select
                value={u.status}
                onChange={(e) => updateStatus(u.id, e.target.value as AmbulanceUnit['status'])}
              >
                <option value="Available">Available</option>
                <option value="On assignment">On assignment</option>
                <option value="Offline">Offline</option>
              </select>
            </div>
          </div>
        ))}
      </section>
      <div className="hospital-data-note">
        Ambulance coordinates and nearby landmarks are synthetic demonstration data, not live GPS tracking.
      </div>
    </ControlShell>
  )
}

export function AlertsPage() {
  const [reports, setReports] = useState<EmergencyRecord[]>([])
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const rows = await api.listControlRoomCases()
      setReports(rows.map(emergencyCaseToRecord))
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load alerts.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const socket = getSocket(null)
    socket.on('case:created', refresh)
    socket.on('case:status', refresh)
    const timer = window.setInterval(() => { void refresh() }, 15000)
    return () => { socket.off('case:created', refresh); socket.off('case:status', refresh); window.clearInterval(timer) }
  }, [refresh])
  const selectedAlert = reports.find(r => r.id === selectedAlertId) ?? reports[0] ?? null
  const newCount = reports.filter((r) => r.status === 'NEW').length
  const processingCount = reports.filter((r) => ['ACKNOWLEDGED', 'AMBULANCE ASSIGNED', 'DISPATCHED', 'PATIENT PICKED UP'].includes(r.status)).length
  const completedCount = reports.filter((r) => r.status === 'COMPLETED').length
  return (
    <ControlShell title="Alerts & Reported Emergencies" subtitle="Live incident register synchronized with the User emergency-reporting page.">
      <section className="cr-metrics alert-case-metrics">
        <div className="cr-metric"><span className="metric-icon mint">＋</span><div><span>New cases</span><strong>{newCount}</strong><small>Awaiting response</small></div></div>
        <div className="cr-metric"><span className="metric-icon amber">◷</span><div><span>Processing</span><strong>{processingCount}</strong><small>Being coordinated</small></div></div>
        <div className="cr-metric"><span className="metric-icon green">✓</span><div><span>Completed</span><strong>{completedCount}</strong><small>Resolved cases</small></div></div>
        <div className="cr-metric"><span className="metric-icon blue">▤</span><div><span>Total reports</span><strong>{reports.length}</strong><small>All received reports</small></div></div>
      </section>
      {error && <div role="alert" className="cr-error-banner">{error}</div>}
      <div className="cr-section-head"><div><h2>Incoming emergency reports</h2><p>{loading ? 'Loading reports…' : `${reports.length} reports loaded from the shared backend.`}</p></div></div>
      <div className="cr-alert-map-layout">
        <section className="cr-panel">
          <div className="hospital-list-head"><div><h2>Reported incident map</h2><p>Select a pin to inspect its emergency report</p></div><span className="cr-live-pill">SATELLITE</span></div>
          <div style={{height:420,width:'100%'}} className="alerts-satellite-map">
            <MapContainer key={selectedAlert?.id || 'all-alerts'} center={selectedAlert ? [selectedAlert.location.lat,selectedAlert.location.lng] : [12.9716,77.5946]} zoom={selectedAlert?14:11} scrollWheelZoom style={{height:'100%',width:'100%'}}>
              <TileLayer attribution='Imagery © Esri, Maxar, Earthstar Geographics' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
              {reports.filter(r=>Number.isFinite(r.location.lat)&&Number.isFinite(r.location.lng)).map(r=><Marker key={r.id} position={[r.location.lat,r.location.lng]} icon={emergencyPin(r.severity.toLowerCase())} eventHandlers={{click:()=>setSelectedAlertId(r.id)}}><Popup><strong>{r.id}</strong><br/>{r.typeLabel} · {r.severity}<br/>{r.location.address}</Popup></Marker>)}
            </MapContainer>
          </div>
        </section>
        <section className="cr-panel cr-alert-selected">
          {selectedAlert ? <div style={{padding:18}}>
            <span className="cr-eyebrow">SELECTED EMERGENCY</span><h2>{selectedAlert.typeEmoji} {selectedAlert.typeLabel}</h2><p className="cr-card-copy">{selectedAlert.id} · {selectedAlert.severity}</p>
            <p className="cr-card-copy"><b>Location:</b> {selectedAlert.location.address}</p>
            <p className="cr-card-copy"><b>Reported by:</b> {selectedAlert.caller.name} · {selectedAlert.caller.phone}</p>
            <p className="cr-card-copy"><b>Status:</b> {selectedAlert.status}</p>
            <p className="cr-card-copy"><b>Ambulance:</b> {selectedAlert.assignedAmbulance?.label || 'Awaiting assignment'}</p>
            <p className="cr-card-copy"><b>Driver:</b> {selectedAlert.assignedAmbulance?.driver || 'Pending'}</p>
            <p className="cr-card-copy"><b>ETA:</b> {selectedAlert.etaMinutes != null ? `${selectedAlert.etaMinutes} min (estimate)` : 'Not available'}</p>
            <p className="cr-card-copy"><b>Hospital:</b> {selectedAlert.hospital?.name || 'Pending recommendation'}</p>
            <p className="cr-card-copy">{selectedAlert.medicalNotes || 'No additional notes.'}</p>
          </div> : <div className="cr-empty">No report selected yet.</div>}
        </section>
      </div>
      <section className="cr-panel alerts-register"><div className="hospital-list-head"><div><h2>Emergency alerts register</h2><p>All reported incidents · select a row to focus its map pin</p></div><span className="cr-live-pill">{reports.length} RECORDS</span></div><div className="alerts-register-scroll"><table className="alerts-register-table"><thead><tr><th>Incident</th><th>Emergency type</th><th>Reported by</th><th>Latitude</th><th>Longitude</th><th>Time</th><th>Status</th><th>Severity</th><th>Location</th></tr></thead><tbody>{reports.map(r=><tr key={r.id} className={selectedAlertId===r.id?'selected':''} onClick={()=>setSelectedAlertId(r.id)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedAlertId(r.id)}}}><td><strong>{r.id}</strong></td><td><span className="alert-type-cell">{r.typeId==='poisoning'?'☣️':r.typeEmoji} {r.typeLabel}</span></td><td>{r.caller.name||'Not provided'}</td><td>{r.location.lat.toFixed(5)}</td><td>{r.location.lng.toFixed(5)}</td><td>{r.timeString}</td><td>{r.status}</td><td><span className={'cr-status '+(r.severity==='Critical'?'new':'processing')}>{r.severity}</span></td><td>{r.location.address||'GPS location'}</td></tr>)}</tbody></table>{!loading&&reports.length===0&&<p className="cr-empty">No emergency reports have been received yet.</p>}{loading&&<p className="cr-empty">Loading reports…</p>}</div></section>
    </ControlShell>
  )
}
