import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiException, type RouteEstimate } from '../api/client'
import {
  ACTIVE_STATUSES,
  EMERGENCY_TYPES,
  type CaseStatus,
  type EmergencyCase,
  type Hospital,
} from '../types/contract'
import './ReportEmergency.css'
import './states.css'
import { ControlShell } from './ControlRoom'
import AICallMap from '../components/AICallMap'
import './TrackCase.css'
import './control-room.css'

const ORDER: CaseStatus[] = [
  'waiting',
  'offered',
  'assigned',
  'en_route',
  'reached_patient',
  'heading_to_hospital',
  'handed_over',
  'completed',
]

const STEP_TEXT: { status: CaseStatus; title: string; desc: string }[] = [
  {
    status: 'waiting',
    title: 'Request received',
    desc: 'Your request is saved with the case ID above',
  },
  {
    status: 'offered',
    title: 'Contacting nearest ambulance',
    desc: 'Waiting for a driver to accept',
  },
  {
    status: 'assigned',
    title: 'Ambulance assigned',
    desc: 'A driver has accepted your request',
  },
  {
    status: 'en_route',
    title: 'Ambulance on the way',
    desc: 'Stay where you are and keep your phone nearby',
  },
  {
    status: 'reached_patient',
    title: 'Ambulance has reached you',
    desc: 'The crew is with you',
  },
  {
    status: 'heading_to_hospital',
    title: 'Heading to hospital',
    desc: 'You are being taken to the hospital',
  },
  {
    status: 'handed_over',
    title: 'Handed over to hospital',
    desc: 'The hospital team has taken over',
  },
  {
    status: 'completed',
    title: 'Ambulance arrival confirmed',
    desc: 'The dispatch workflow has reached its final demo status',
  },
]

const HEAD: Record<
  CaseStatus,
  { icon: string; title: string; sub: string }
> = {
  waiting: {
    icon: '🔎',
    title: 'Finding an ambulance',
    sub: 'Looking for the nearest available ambulance',
  },
  offered: {
    icon: '📡',
    title: 'Contacting an ambulance',
    sub: 'Waiting for the driver to respond',
  },
  assigned: {
    icon: '🚑',
    title: 'Ambulance assigned',
    sub: 'A driver has accepted your request',
  },
  en_route: {
    icon: '🚑',
    title: 'Ambulance is on the way',
    sub: 'Stay where you are and keep your phone nearby',
  },
  reached_patient: {
    icon: '📍',
    title: 'Ambulance has reached you',
    sub: 'The crew is with you now',
  },
  heading_to_hospital: {
    icon: '🏥',
    title: 'On the way to the hospital',
    sub: 'You are being taken for care',
  },
  handed_over: {
    icon: '✅',
    title: 'Handed over to the hospital',
    sub: 'The hospital team has taken over',
  },
  completed: {
    icon: '✅',
    title: 'Ambulance arrival confirmed',
    sub: 'Arrival status confirmed in the demo workflow',
  },
  cancelled: {
    icon: '✖',
    title: 'Request cancelled',
    sub: 'This request was cancelled',
  },
}

const distanceKm = (a: {lat:number; lng:number}, b: {lat:number; lng:number}) => {
  const rad = (n: number) => n * Math.PI / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

export default function TrackCase() {
  const { caseId } = useParams<{ caseId: string }>()

  const [data, setData] = useState<EmergencyCase | null>(null)
  const [nearbyHospitals, setNearbyHospitals] = useState<Hospital[]>([])
  const [ambulanceRoute, setAmbulanceRoute] = useState<RouteEstimate | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(
    null
  )

  // Route transitions can preserve the previous page's scroll position in an SPA.
  // Always start the dispatch page at its heading after navigation.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [caseId])

  // Live updates for this case. Cleans up when leaving the page.
  useEffect(() => {
    if (!caseId) return
    setData(null)
    setError(null)
    const stop = api.subscribeCase(
      caseId,
      (c) => {
        setData(c)
        setError(null)
      },
      (e) => setError(e)
    )
    return stop
  }, [caseId, attempt])

  useEffect(() => {
    let alive = true
    api.listHospitals().then((items) => {
      if (alive) setNearbyHospitals(items)
    }).catch(() => {
      if (alive) setNearbyHospitals([])
    })
    return () => { alive = false }
  }, [])

  // Build a road-network route from the assigned ambulance's latest known GPS fix.
  useEffect(() => {
    let alive = true
    const ambulance = data?.ambulance
    if (!data?.pickup || !ambulance || !Number.isFinite(ambulance.lat) || !Number.isFinite(ambulance.lng)) {
      setAmbulanceRoute(null)
      return
    }
    api.getAmbulanceRoute(
      { lat: ambulance.lat as number, lng: ambulance.lng as number },
      { lat: data.pickup.lat, lng: data.pickup.lng },
    ).then((route) => { if (alive) setAmbulanceRoute(route) })
      .catch(() => { if (alive) setAmbulanceRoute(null) })
    return () => { alive = false }
  }, [data?.id, data?.ambulance?.lat, data?.ambulance?.lng, data?.pickup?.lat, data?.pickup?.lng])

  // Clock used only for the "still searching" warning.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const copyId = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: the ID is still visible on screen */
    }
  }

  const doCancel = async () => {
    if (!data || cancelling) return
    setCancelling(true)
    setCancelError(null)
    try {
      const updated = await api.cancelCase(data.id, reason)
      setData(updated)
      setConfirming(false)
    } catch (e) {
      setCancelError(
        e instanceof Error
          ? e.message
          : 'Could not cancel. Please try again.'
      )
    } finally {
      setCancelling(false)
    }
  }

  // ---------- loading / error / not found ----------
  if (!data) {
    const notFound =
      error instanceof ApiException && error.code === 'NOT_FOUND'
    return (
      <ControlShell title="Ambulance dispatch" subtitle="Track emergency response progress and nearby care facilities.">
      <div className="er-page er-page-embedded">
        <main className="er-main">
          <div className="er-layout er-dispatch-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 420px)' }}>
            <div className="er-card">
              {!error && (
                <div className="er-sending" role="status">
                  <div className="er-pulse">🚨</div>
                  <p>Loading your case…</p>
                </div>
              )}

              {error && notFound && (
                <div className="af-center">
                  <h2>Case not found</h2>
                  <p>
                    We could not find case {caseId}. Check the
                    link, or report a new emergency.
                  </p>
                  <Link className="af-primary" to="/emergency">
                    Report an emergency
                  </Link>
                </div>
              )}

              {error && !notFound && (
                <div className="af-center">
                  <h2>Could not load this case</h2>
                  <p>{error.message}</p>
                  <button
                    type="button"
                    className="af-link-btn"
                    onClick={() => setAttempt((a) => a + 1)}
                  >
                    Retry
                  </button>
</div>
              )}
            </div>
          </div>
        </main>
      </div>
      </ControlShell>
    )
  }

  // ---------- case view ----------
  const cancelled = data.status === 'cancelled'
  const finished = cancelled || data.status === 'completed'
  const canCancel = ACTIVE_STATUSES.includes(data.status)
  const typeInfo = EMERGENCY_TYPES.find((t) => t.id === data.type)
  const head = HEAD[data.status]

  const lastReal =
    [...data.history]
      .reverse()
      .find((h) => h.status !== 'cancelled')?.status ?? 'waiting'
  const lastIdx = ORDER.indexOf(lastReal)

  const timeFor = (s: CaseStatus) =>
    data.history.find((h) => h.status === s)?.at

  // A confirmed step gets its green tick after a short 3-second visual
  // confirmation. The backend remains the source of truth for progression.
  const stepState = (i: number): 'done' | 'active' | '' => {
    const cur = lastIdx === 0 ? 1 : lastIdx
    const status = STEP_TEXT[i]?.status
    const confirmedAt = (status === 'waiting' ? data.createdAt : (status ? timeFor(status) : undefined)) || data.createdAt
    const confirmed = i === 0 || data.status === 'completed' || (cancelled ? i <= lastIdx : i < cur)
    if (confirmed) {
      const elapsed = confirmedAt ? now - new Date(confirmedAt).getTime() : 3000
      return elapsed >= 3000 ? 'done' : 'active'
    }
    if (!cancelled && i === cur) return 'active'
    return ''
  }

  const confirmationCountdown = (status: CaseStatus) => {
    const at = (status === 'waiting' ? data.createdAt : timeFor(status)) || timeFor(lastReal) || data.createdAt
    if (!at) return 3
    return Math.max(0, 3 - Math.floor(Math.max(0, now - new Date(at).getTime()) / 1000))
  }

  const searchingLong =
    data.status === 'waiting' &&
    now - new Date(data.createdAt).getTime() > 20000

  return (
    <ControlShell title="Ambulance dispatch" subtitle="Track emergency response progress and nearby care facilities.">
    <div className="er-page er-page-embedded">
      <main className="er-main">
        <div className="er-layout er-dispatch-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 420px)' }}>
          <div className="er-card">
            <div className="er-dispatch">
              <h1 className="dispatch-page-title">Ambulance Dispatch Information</h1>

              {['en_route', 'reached_patient', 'heading_to_hospital', 'handed_over', 'completed'].includes(data.status) && !cancelled && (
                <section className="af-response-initiated" role="status" aria-live="polite">
                  <div className="af-response-check" aria-hidden="true">✓</div>
                  <h2>Emergency Response Initiated!</h2>
                  <p>All dispatch steps have completed. Your ambulance is on the way.</p>
                  <Link className="af-response-button" to="/emergency">
                    Report Another Emergency
                  </Link>
                </section>
              )}

              {error && (
                <div className="af-warn" role="status">
                  Connection problem — showing the last known
                  status and retrying…
                </div>
              )}

              <div className="er-dispatch-head">
                <div
                  className="er-dispatch-icon"
                  style={
                    cancelled
                      ? {
                          background: 'rgba(225,29,46,0.15)',
                          borderColor: '#e11d2e',
                        }
                      : undefined
                  }
                >
                  {head.icon}
                </div>
                <div>
                  <h2>{head.title}</h2>
                  <p>{head.sub}</p>
                </div>
              </div>

              <div className="af-meta">
                <span>Case ID</span>
                <code>{data.id}</code>
                <button
                  type="button"
                  className="af-link-btn"
                  style={{ marginTop: 0 }}
                  onClick={copyId}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <span className={`af-badge ${data.severity}`}>
                  {data.severity}
                </span>
                {typeInfo && <span>{typeInfo.label}</span>}
              </div>
              {searchingLong && (
                <div className="af-warn" role="status">The demo is still searching for a simulated ambulance.</div>
              )}

              {cancelled && (
                <div className="af-info">
                  Cancelled
                  {data.cancelReason
                    ? ` — reason: ${data.cancelReason}`
                    : ''}
                  .
                </div>
              )}

              {/* TIMELINE */}
              <div className="er-timeline">
                {STEP_TEXT.map((s, i) => {
                  const state = stepState(i)
                  const at = timeFor(s.status)
                  const desc =
                    i === 1 && data.status === 'waiting'
                      ? 'Looking for an available ambulance'
                      : s.desc
                  return (
                    <div
                      key={s.status}
                      className={`er-tl-item ${state}`}
                    >
                      <div className="dot">
                        {state === 'done' ? '✓' : ''}
                      </div>
                      <div className="txt">
                        <div className="t">
                          {s.title}
                          {at && state !== '' && (
                            <span className="af-time">
                              {fmtTime(at)}
                            </span>
                          )}
                        </div>
                        <div className="d">{desc}</div>
                        {state === 'active' && (
                          <div className="af-step-confirm">
                            <span>{i < lastIdx || i === 0 ? 'Confirming step' : 'Stage timer'} · {confirmationCountdown(s.status)}s</span>
                            <i><b style={{ width: `${((3 - confirmationCountdown(s.status)) / 3) * 100}%` }} /></i>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}

                {cancelled && (
                  <div className="er-tl-item done">
                    <div className="dot">✕</div>
                    <div className="txt">
                      <div className="t">
                        Cancelled
                        <span className="af-time">
                          {fmtTime(
                            data.history[data.history.length - 1].at
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* INFO */}
              <div className="er-info-grid">
                <div className="er-info-box">
                  <div className="k">Emergency reported by</div>
                  <div className="v small">{data.reporterName}</div>
                  <div className="af-note">Contact: <strong>{data.reporterPhone}</strong></div>
                </div>
                <div className="er-info-box">
                  <div className="k">Estimated arrival</div>
                  <div className="v eta">
                    {data.etaMinutes !== undefined
                      ? `~${data.etaMinutes} min`
                      : '—'}
                  </div>
                  <div className="af-note">
                    Estimate only. Does not include live traffic.
                  </div>
                </div>

                <div className="er-info-box">
                  <div className="k">Ambulance That Accepted Your Request</div>
                  {data.ambulance ? (
                    <>
                      <div className="v small">
                        🚑 {data.ambulance.vehicleNumber}
                        {data.ambulance.isTest && (
                          <span className="af-badge test">Demo ambulance</span>
                        )}
                      </div>
                      <div className="af-note">
                        Driver: <strong>{data.ambulance.driverFirstName}</strong>
                      </div>
                      <div className="af-accepted-status">
                        <span aria-hidden="true">✓</span> Request accepted — ambulance assigned
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="v small">No ambulance has accepted yet</div>
                      <div className="af-note">The accepted ambulance and driver will appear here when assignment is confirmed.</div>
                    </>
                  )}
                </div>

                <div
                  className="er-info-box"
                  style={{ gridColumn: '1 / -1' }}
                >
                  <div className="k">Recommended hospital</div>
                  {data.hospital ? (
                    <>
                      <div className="v small">
                        {data.hospital.name}
                      </div>
                      {data.hospital.address && (
                        <div className="af-note">
                          {data.hospital.address}
                        </div>
                      )}
                      {data.hospitalReason && (
                        <div className="af-note">
                          {data.hospitalReason}
                        </div>
                      )}
                      {data.hospital.capacityStatus ===
                        'unknown' && (
                        <div className="af-note">
                          Bed availability: unknown
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="v small">
                      Not recommended yet
                    </div>
                  )}
                </div>
              </div>
              <div className="er-safety-line">Student project demo — dispatch and ambulance statuses are simulated.</div>

              {/* CANCEL */}
              {canCancel && !confirming && (
                <button
                  type="button"
                  className="er-cancel-req"
                  onClick={() => {
                    setConfirming(true)
                    setCancelError(null)
                  }}
                >
                  Cancel this request
                </button>
              )}

              {canCancel && confirming && (
                <div className="af-confirm">
                  <p>
                    Cancel this request? The ambulance will no
                    longer be sent to you.
                  </p>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (optional)"
                    aria-label="Reason for cancelling"
                  />
                  {cancelError && (
                    <div
                      className="af-field-error"
                      role="alert"
                    >
                      {cancelError}
                    </div>
                  )}
                  <div className="af-confirm-row">
                    <button
                      type="button"
                      disabled={cancelling}
                      onClick={() => setConfirming(false)}
                    >
                      Keep request
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={cancelling}
                      onClick={doCancel}
                    >
                      {cancelling
                        ? 'Cancelling…'
                        : cancelError
                          ? 'Retry cancel'
                          : 'Yes, cancel'}
                    </button>
                  </div>
                </div>
              )}

              {finished && (
                <Link
                  className="af-primary"
                  to="/emergency"
                  style={{
                    marginTop: 16,
                    textAlign: 'center',
                    display: 'block',
                    padding: 12,
                    borderRadius: 10,
                    background: '#e11d2e',
                    color: '#fff',
                    fontWeight: 600,
                  }}
                >
                  Report another emergency
                </Link>
              )}
            </div>
          </div>
          <aside className="er-side dispatch-hospital-sidebar">
            <section className="er-side-card">
              <div className="er-side-head">
                <span aria-hidden="true">🏥</span>
                <h3>Nearby hospitals</h3>
              </div>
              <p className="er-loc-status">Hospitals near the reported location, sorted by distance.</p>
              {data.pickup && nearbyHospitals.length > 0 ? (
                <div className="dispatch-hospital-list">
                  {[...nearbyHospitals]
                    .sort((a, b) => distanceKm(data.pickup, a) - distanceKm(data.pickup, b))
                    .slice(0, 6)
                    .map((hospital) => {
                      const distance = distanceKm(data.pickup, hospital)
                      const eta = Math.max(1, Math.round(distance / 30 * 60))
                      return (
                        <div className="dispatch-hospital-item" key={hospital.id}>
                          <div className="dispatch-hospital-title-row">
                            <div className="dispatch-hospital-logo" aria-hidden="true">
                              <svg viewBox="0 0 48 48" role="img" focusable="false">
                                <path d="M9 40V14h30v26M17 14V7h14v7M5 40h38" />
                                <path d="M21 20h6v6h6v6h-6v6h-6v-6h-6v-6h6z" className="hospital-logo-cross" />
                                <path d="M14 18h3m14 0h3M14 35h3m14 0h3" />
                              </svg>
                            </div>
                            <div className="dispatch-hospital-name-wrap">
                              <strong>{hospital.name}</strong>
                              <span className="dispatch-hospital-label">Nearby hospital</span>
                            </div>
                          </div>
                          {hospital.address && <span className="dispatch-hospital-address">{hospital.address}</span>}
                          <div className="dispatch-hospital-meta">
                            <span><span aria-hidden="true">📍 </span>{distance.toFixed(1)} km away</span>
                            <span><span aria-hidden="true">🕒 </span>Est. {eta} min</span>
                          </div>
                          {data.hospital?.id === hospital.id && <span className="dispatch-capacity" style={{ borderColor: '#16a34a', color: '#15803d', fontWeight: 800 }}>★ Recommended for this emergency</span>}
                          <span className="dispatch-capacity">Capacity: {hospital.capacityStatus || 'unknown'}</span>
                          {hospital.phone && <a className="dispatch-hospital-call" href={`tel:${hospital.phone}`}>☎ Call {hospital.phone}</a>}
                        </div>
                      )
                    })}
                </div>
              ) : (
                <p className="af-note">Nearby hospital data is not available in this demo.</p>
              )}
              {data.hospitalReason && <p className="dispatch-estimate-note"><strong>Hospital recommendation:</strong> {data.hospitalReason}</p>}
              <p className="dispatch-estimate-note">Travel times are rough estimates based on distance, not live traffic or confirmed hospital availability.</p>
            </section>
          </aside>
        </div>

        {data.pickup && (
          <section className="dispatch-satellite-section" aria-label="Emergency satellite map">
            <h2>Emergency location · Satellite view</h2>
            <p>Reported location, nearby hospitals and illustrative ambulance positions.</p>
            <AICallMap
              position={{ lat: data.pickup.lat, lng: data.pickup.lng }}
              status="ok"
              heading="EMERGENCY LOCATION · SATELLITE"
              assignedHospital={data.hospital ? { name: data.hospital.name, lat: data.hospital.lat, lng: data.hospital.lng } : undefined}
              assignedAmbulance={data.ambulance && Number.isFinite(data.ambulance.lat) && Number.isFinite(data.ambulance.lng)
                ? { name: `${data.ambulance.label} · ${data.ambulance.vehicleNumber}`, lat: data.ambulance.lat as number, lng: data.ambulance.lng as number }
                : undefined}
              ambulanceRoute={ambulanceRoute ?? undefined}
            />
          </section>
        )}

        <p className="er-bottom-note">
          AidFlow college project — demo dispatch workflow with simulated data.
        </p>
      </main>
    </div>
    </ControlShell>
  )
}
