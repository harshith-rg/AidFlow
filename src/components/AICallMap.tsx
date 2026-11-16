import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './AICallScreen.css'
import bengaluruHospitals from '../data/bengaluru_hospitals_merged.json'
import bengaluruAmbulances from '../data/bengaluru_ambulances_demo.json'

export type Position = { lat: number; lng: number; accuracy?: number }
type Hospital = { id: string; name: string; lat: number; lng: number; address?: string }
type Nearby = Hospital & { km: number }
type Unit = { id: string; name: string; lat: number; lng: number; km: number }

const NEARBY_COUNT = 10
const AMBULANCE_COUNT = 10
const MAP_HOSPITAL_COUNT = 5
const MAP_AMBULANCE_COUNT = 5

const userIcon = L.divIcon({ className: 'acm-marker', html: '<span class="acm-emergency-marker"><i></i><b></b></span>', iconSize: [54, 54], iconAnchor: [27, 27] })
const hospitalIcon = L.divIcon({ className: 'acm-marker', html: '<span class="acm-hospital">✚</span>', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14] })
const ambulanceIcon = L.divIcon({ className: 'acm-marker', html: '<span class="acm-ambulance">🚑</span>', iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -14] })

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Synthetic Bengaluru ambulance fleet dataset; not live GPS.
function demoAmbulances(p: Position): Unit[] {
  return (bengaluruAmbulances as Array<{id:string;label?:string;lat:number;lng:number}>)
    .filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng))
    .map(a => ({ id:a.id, name:a.label || a.id, lat:a.lat, lng:a.lng, km:haversineKm(p,a) }))
    .sort((a,b) => a.km-b.km).slice(0, AMBULANCE_COUNT)
}

function FitNearby({ position, hospitals, ambulances, assignedAmbulance, route }: {
  position: Position
  hospitals: Nearby[]
  ambulances: Unit[]
  assignedAmbulance?: Assigned
  route?: RouteLine
}) {
  const map = useMap()
  const key = `${position.lat.toFixed(5)},${position.lng.toFixed(5)}:${hospitals.map(h => h.id).join(',')}:${ambulances.map(a => a.id).join(',')}`
  useEffect(() => {
    // Keep the emergency visible while framing the closest useful service pins.
    const points: [number, number][] = [
      [position.lat, position.lng],
      ...hospitals.slice(0, MAP_HOSPITAL_COUNT).map(h => [h.lat, h.lng] as [number, number]),
      ...ambulances.slice(0, MAP_AMBULANCE_COUNT).map(a => [a.lat, a.lng] as [number, number]),
      ...(assignedAmbulance ? [[assignedAmbulance.lat, assignedAmbulance.lng] as [number, number]] : []),
      ...(route?.geometry ?? []).map(point => [point.lat, point.lng] as [number, number]),
    ]
    map.fitBounds(L.latLngBounds(points), {
      padding: [30, 30],
      maxZoom: 15,
      animate: true,
      duration: 0.6,
    })
  }, [key, map, position.lat, position.lng, assignedAmbulance?.lat, assignedAmbulance?.lng, route?.geometry?.length])
  return null
}

const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(6)}° ${v >= 0 ? pos : neg}`

type Assigned = { name: string; lat: number; lng: number }
type RouteLine = { geometry: Array<{lat:number;lng:number}>; distanceKm: number; durationMin: number; source?: string }

export default function AICallMap({ position, status, heading = 'LIVE LOCATION · SATELLITE', assignedHospital, assignedAmbulance, ambulanceRoute }: {
  position: Position | null
  status: 'detecting' | 'ok' | 'denied' | 'unsupported'
  heading?: string
  assignedHospital?: Assigned
  assignedAmbulance?: Assigned
  ambulanceRoute?: RouteLine
}) {
  const [hospitals] = useState<Hospital[]>(bengaluruHospitals as Hospital[])

  const nearbyHospitals = useMemo<Nearby[]>(() => {
    if (!position) return []
    return hospitals
      .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng))
      .map((h) => ({ ...h, km: haversineKm(position, h) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, NEARBY_COUNT)
  }, [hospitals, position])

  // Ambulances are keyed to the position rounded to ~1 km so they don't jitter with every GPS update.
  const roundedKey = position ? `${position.lat.toFixed(2)},${position.lng.toFixed(2)}` : ''
  const ambulances = useMemo(() => (position ? demoAmbulances(position) : []), [roundedKey]) // eslint-disable-line react-hooks/exhaustive-deps



  const message =
    status === 'ok' ? 'Location detected automatically'
    : status === 'denied' ? 'Location blocked. Allow location access in your browser settings.'
    : status === 'unsupported' ? 'This browser cannot detect location.'
    : 'Detecting your location…'

  return (
    <aside className="acm-panel" aria-label="Satellite map of your location, nearby hospitals and ambulances">
      <div className="acm-head">
        <span className="acm-eyebrow">{heading}</span>
        <span className={`acm-status acm-status-${status}`}><i />{message}</span>
      </div>

      <div className="acm-coords" aria-live="polite">
        <div><small>LATITUDE</small><strong>{position ? fmt(position.lat, 'N', 'S') : '—'}</strong></div>
        <div><small>LONGITUDE</small><strong>{position ? fmt(position.lng, 'E', 'W') : '—'}</strong></div>
        <div><small>ACCURACY</small><strong>{position?.accuracy !== undefined ? `±${Math.round(position.accuracy)} m` : '—'}</strong></div>
      </div>

      <div className="acm-map-wrap">
        {position ? (
          <MapContainer center={[position.lat, position.lng]} zoom={17} scrollWheelZoom className="acm-map">
            <TileLayer attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
            <FitNearby position={position} hospitals={nearbyHospitals} ambulances={ambulances} assignedAmbulance={assignedAmbulance} route={ambulanceRoute} />
            <Marker position={[position.lat, position.lng]} icon={userIcon} zIndexOffset={2000}>
              <Popup><strong>Your current location</strong><br />{position.lat.toFixed(6)}, {position.lng.toFixed(6)}</Popup>
            </Marker>
            {nearbyHospitals.slice(0, MAP_HOSPITAL_COUNT).filter((h) => !(assignedHospital && h.lat === assignedHospital.lat && h.lng === assignedHospital.lng)).map((h) => (
              <Marker key={h.id} position={[h.lat, h.lng]} icon={hospitalIcon}>
                <Popup><strong>{h.name}</strong><br />{h.km.toFixed(1)} km away{h.address ? <><br />{h.address}</> : null}<br /><a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`}>Directions</a></Popup>
              </Marker>
            ))}
            {assignedAmbulance && (
              <>
                <Polyline
                  positions={ambulanceRoute?.geometry?.length
                    ? ambulanceRoute.geometry.map(point => [point.lat, point.lng] as [number, number])
                    : [[assignedAmbulance.lat, assignedAmbulance.lng], [position.lat, position.lng]]}
                  pathOptions={{ color: '#fbbf24', weight: 6, opacity: 0.92 }}
                />
                <Marker position={[assignedAmbulance.lat, assignedAmbulance.lng]} icon={ambulanceIcon} zIndexOffset={1000}>
                  <Popup><strong>{assignedAmbulance.name}</strong><br />Assigned to your case<br /><small>Demo position, not live GPS</small></Popup>
                </Marker>
              </>
            )}
            {assignedHospital && (
              <Marker position={[assignedHospital.lat, assignedHospital.lng]} icon={hospitalIcon} zIndexOffset={900}>
                <Popup><strong>{assignedHospital.name}</strong><br />Destination hospital<br /><a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${assignedHospital.lat},${assignedHospital.lng}`}>Directions</a></Popup>
              </Marker>
            )}
            {ambulances.slice(0, MAP_AMBULANCE_COUNT).map((a) => (
              <Marker key={a.id} position={[a.lat, a.lng]} icon={ambulanceIcon}>
                <Popup><strong>{a.name}</strong><br />{a.km.toFixed(1)} km away<br /><small>Synthetic demo dataset location, not live GPS</small></Popup>
              </Marker>
            ))}
          </MapContainer>
        ) : (
          <div className="acm-placeholder">
            <div className="acm-spinner" />
            <p>{message}</p>
          </div>
        )}
      </div>

      {assignedAmbulance && ambulanceRoute && (
        <div className="acm-route-summary" role="status">
          <div><small>AMBULANCE ROUTE TO YOU</small><strong>{ambulanceRoute.distanceKm.toFixed(1)} km</strong></div>
          <div><small>ESTIMATED ARRIVAL</small><strong>{ambulanceRoute.durationMin} min</strong></div>
          <p>{ambulanceRoute.source === 'graph' ? "Shortest path calculated with Dijkstra on AidFlow's Bengaluru demo road graph." : "Straight-line fallback estimate; the ambulance location is outside the demo road graph."} Traffic is not included.</p>
        </div>
      )}
      <div className="acm-legend">
        <span><i className="acm-dot acm-dot-user" /> Emergency reported here</span>
        <span><i className="acm-dot acm-dot-hospital">✚</i> Hospitals</span>
        <span><i className="acm-dot acm-dot-ambulance">🚑</i> Ambulances</span>
      </div>

      {position && (
        <div className="acm-lists">
          <div>
            <h4>Nearest hospitals</h4>
            {nearbyHospitals.length === 0 ? <p className="acm-muted">Loading hospital directory…</p> : (
              <ul>{nearbyHospitals.map((h) => <li key={h.id}><span>{h.name}</span><b>{h.km.toFixed(1)} km</b></li>)}</ul>
            )}
          </div>
          <div>
            <h4>Nearby ambulances</h4>
            <ul>{ambulances.map((a) => <li key={a.id}><span>{a.name}</span><b>{a.km.toFixed(1)} km</b></li>)}</ul>
          </div>
        </div>
      )}
      <p className="acm-note">Imagery © Esri. Hospital locations are directory-derived; ambulance positions are synthetic demo locations, not live GPS.</p>
    </aside>
  )
}
