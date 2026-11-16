import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import LiveLocationMap from '../components/LiveLocationMap'
import { api } from '../api/client'
import {
  EMERGENCY_TYPES,
  type EmergencyTypeId,
} from '../types/contract'
import { isValidName, normalizePhone } from '../utils/validation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import './control-room.css'
import './ReportEmergency.css'
import './states.css'

type Step = 0 | 1 | 2
type Phase = 'form' | 'sending'
type LocStatus = 'locating' | 'ok' | 'error'

export default function ReportEmergency() {
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>(0)
  const [phase, setPhase] = useState<Phase>('form')

  const [selectedType, setSelectedType] =
    useState<EmergencyTypeId | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [details, setDetails] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  const [coords, setCoords] = useState<{
    lat: number
    lng: number
  } | null>(null)
  const [locStatus, setLocStatus] =
    useState<LocStatus>('locating')
  const [locError, setLocError] = useState<string | null>(null)

  const [submitError, setSubmitError] =
    useState<string | null>(null)

  // Blocks double submits even if the button is clicked twice quickly.
  const submittingRef = useRef(false)

  /**
   * Browser location. Runs on page load and again when the
   * user presses "Try again". Errors are shown on screen.
   */
  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocStatus('error')
      setLocError(
        'This browser does not support location. Try another browser or use the map to choose a location.'
      )
      return
    }

    setLocStatus('locating')
    setLocError(null)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
        setLocStatus('ok')
        setLocError(null)
      },
      (error) => {
        setLocStatus('error')
        if (error.code === 1) {
          setLocError(
            'Location permission was denied. Allow location for this site in your browser settings, then press Try again.'
          )
        } else if (error.code === 2) {
          setLocError(
            'Your location is unavailable right now. Check that GPS or location services are on, then press Try again.'
          )
        } else if (error.code === 3) {
          setLocError(
            'Finding your location took too long. Press Try again.'
          )
        } else {
          setLocError(
            'Could not get your location. Press Try again.'
          )
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 30000,
        maximumAge: 30000,
      }
    )
  }, [])

  useEffect(() => {
    requestLocation()
  }, [requestLocation])

  // Stable function: the map component re-runs its effect if this changes.
  const handleMapLocation = useCallback(
    (c: { lat: number; lng: number }) => {
      setCoords(c)
      setLocStatus('ok')
      setLocError(null)
    },
    []
  )

  const phoneDigits = normalizePhone(phone)
  const nameOk = isValidName(name)
  const typeInfo =
    EMERGENCY_TYPES.find((t) => t.id === selectedType) ?? null

  const nameError =
    showErrors && !nameOk ? 'Please enter your full name.' : null
  const phoneError =
    showErrors && !phoneDigits
      ? 'Please enter a 10-digit number.'
      : null

  const goToConfirm = () => {
    if (!nameOk || !phoneDigits) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    setStep(2)
  }

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()

    if (submittingRef.current) return
    if (!selectedType || !coords) return

    if (!nameOk || !phoneDigits) {
      setShowErrors(true)
      setStep(1)
      return
    }

    submittingRef.current = true
    setSubmitError(null)
    setPhase('sending')

    try {
      const created = await api.createEmergency({
        type: selectedType,
        reporterName: name.trim(),
        reporterPhone: phoneDigits,
        description: details.trim() || undefined,
        pickup: coords,
      })
      navigate(`/track/${created.id}`)
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.'
      )
      setPhase('form')
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <>
    <Header />
    <div className="er-page">
      {/* MAIN */}
      <main className="er-main">
        <div className="er-layout">
          {/* FORM CARD */}
          <div className="er-card">
            {phase === 'form' && (
              <>
                {/* STEPPER */}
                <div className="er-stepper">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`er-seg ${
                        i === step
                          ? 'active'
                          : i < step
                            ? 'done'
                            : ''
                      }`}
                    />
                  ))}
                </div>

                {/* ======================= */}
                {/* STEP 1 */}
                {/* ======================= */}
                {step === 0 && (
                  <div className="er-panel">
                    <div className="er-step-label">
                      Step 1 of 3 — Type
                    </div>

                    <div className="er-step-title">
                      What's happening?
                    </div>

                    <p className="er-step-sub">
                      Pick the option that best fits — this
                      helps us send the right kind of help.
                    </p>

                    <div className="er-chip-grid">
                      {EMERGENCY_TYPES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`er-chip ${
                            selectedType === t.id
                              ? 'selected'
                              : ''
                          }`}
                          aria-pressed={selectedType === t.id}
                          onClick={() =>
                            setSelectedType(t.id)
                          }
                        >
                          <span className="em">
                            {t.emoji}
                          </span>

                          {t.label}

                        </button>
                      ))}
                    </div>

                    <div className="er-btn-row">
                      <button
                        type="button"
                        className="er-btn-continue"
                        disabled={selectedType === null}
                        onClick={() => setStep(1)}
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {/* ======================= */}
                {/* STEP 2 */}
                {/* ======================= */}
                {step === 1 && (
                  <div className="er-panel">
                    <div className="er-step-label">
                      Step 2 of 3 — Details
                    </div>

                    <div className="er-step-title">
                      Your information
                    </div>

                    <p className="er-step-sub">
                      We'll use this to coordinate the
                      response and call you back if needed.
                    </p>

                    <div className="er-field">
                      <label htmlFor="name">
                        Full name
                      </label>

                      <input
                        id="name"
                        value={name}
                        onChange={(e) =>
                          setName(e.target.value)
                        }
                        placeholder="Your name"
                        autoComplete="name"
                        aria-invalid={nameError !== null}
                        aria-describedby={
                          nameError ? 'name-error' : undefined
                        }
                      />
                      {nameError && (
                        <div
                          id="name-error"
                          className="af-field-error"
                          role="alert"
                        >
                          {nameError}
                        </div>
                      )}
                    </div>

                    <div className="er-field">
                      <label htmlFor="phone">
                        Phone number
                      </label>

                      <input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) =>
                          setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                        }
                        placeholder="Enter 10-digit number"
                        autoComplete="off"
                        inputMode="numeric"
                        maxLength={10}
                        aria-invalid={phoneError !== null}
                        aria-describedby={
                          phoneError ? 'phone-error' : undefined
                        }
                      />
                      {phoneError && (
                        <div
                          id="phone-error"
                          className="af-field-error"
                          role="alert"
                        >
                          {phoneError}
                        </div>
                      )}
                    </div>

                    <div className="er-field">
                      <label htmlFor="details">
                        Describe the emergency (optional)
                      </label>

                      <textarea
                        id="details"
                        value={details}
                        onChange={(e) =>
                          setDetails(e.target.value)
                        }
                        placeholder="What happened, number of people involved, any medical conditions..."
                      />
                    </div>

                    {locError && !coords && (
                      <div className="af-error" role="alert">
                        {locError}
                        <div>
                          <button
                            type="button"
                            className="af-link-btn"
                            onClick={requestLocation}
                          >
                            Try again
                          </button>
                        </div>
                      </div>
                    )}

                    {/* BUTTONS */}
                    <div className="er-btn-row">
                      <button
                        type="button"
                        className="er-btn-back"
                        onClick={() => setStep(0)}
                      >
                        Back
                      </button>

                      <button
                        type="button"
                        className="er-btn-continue"
                        onClick={goToConfirm}
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {/* ======================= */}
                {/* STEP 3 */}
                {/* ======================= */}
                {step === 2 && (
                  <form
                    className="er-panel"
                    onSubmit={handleSend}
                    noValidate
                  >
                    <div className="er-step-label">
                      Step 3 of 3 — Confirm
                    </div>

                    <div className="er-step-title">
                      Review &amp; send
                    </div>

                    <p className="er-step-sub">
                      Check the details below before
                      sending your request.
                    </p>

                    {submitError && (
                      <div className="af-error" role="alert">
                        <strong>Request not sent.</strong>{' '}
                        {submitError}
                      </div>
                    )}

                    {/* REVIEW BOX */}
                    <div className="er-review-list">
                      <div className="er-review-row">
                        <span className="k">
                          Emergency type
                        </span>

                        <span className="v">
                          {typeInfo
                            ? typeInfo.label
                            : '—'}
                        </span>
                      </div>

                      <div className="er-review-row">
                        <span className="k">
                          Name
                        </span>

                        <span className="v">
                          {name.trim() || '—'}
                        </span>
                      </div>


                      <div className="er-review-row">
                        <span className="k">
                          Location
                        </span>

                        <span className="v">
                          {coords
                            ? `${coords.lat.toFixed(
                                5
                              )}, ${coords.lng.toFixed(5)}`
                            : locStatus === 'error'
                              ? 'Unavailable'
                              : 'Locating…'}
                        </span>
                      </div>
                    </div>

                    {locError && !coords && (
                      <div className="af-error" role="alert">
                        {locError}
                        <div>
                          <button
                            type="button"
                            className="af-link-btn"
                            onClick={requestLocation}
                          >
                            Try again
                          </button>
                        </div>
                      </div>
                    )}

                    {/* BUTTONS */}
                    <div className="er-btn-row">
                      <button
                        type="button"
                        className="er-btn-back"
                        onClick={() => setStep(1)}
                      >
                        Back
                      </button>

                      <button
                        type="submit"
                        className="er-btn-send"
                        disabled={!coords}
                      >
                        {submitError
                          ? 'Retry sending'
                          : 'Send emergency request'}
                      </button>
                    </div>

                    {!coords && (
                      <div className="af-hint">
                        Waiting for your location before
                        you can send.
                      </div>
                    )}
                  </form>
                )}
              </>
            )}

            {/* ======================= */}
            {/* SENDING */}
            {/* ======================= */}
            {phase === 'sending' && (
              <div className="er-sending" role="status">
                <div className="er-pulse">
                  🚨
                </div>

                <p>
                  Sending your request…
                </p>
              </div>
            )}
          </div>

          {/* RIGHT SIDE LOCATION BOX */}
          <div className="er-side">
            <div className="er-side-card">
              <div className="er-side-head">
                <div
                  className={`er-loc-dot ${
                    coords ? 'live' : ''
                  }`}
                />

                <h3>Your location</h3>
              </div>

              <p
                className={`er-loc-status ${
                  coords ? 'ok' : ''
                }`}
              >
                {coords
                  ? 'Location detected'
                  : locStatus === 'error'
                    ? 'Location unavailable'
                    : 'Detecting your location…'}
              </p>

              <div className="er-coord-row">
                <div className="er-coord-box">
                  <div className="k">Lat</div>

                  <div className="v">
                    {coords
                      ? coords.lat.toFixed(4)
                      : '—'}
                  </div>
                </div>

                <div className="er-coord-box">
                  <div className="k">Lng</div>

                  <div className="v">
                    {coords
                      ? coords.lng.toFixed(4)
                      : '—'}
                  </div>
                </div>
              </div>

              {coords && (
                <a
                  className="er-maps-link"
                  href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Google Maps ↗
                </a>
              )}

              {locStatus === 'error' && (
                <button
                  type="button"
                  className="af-link-btn"
                  onClick={requestLocation}
                >
                  Try again
                </button>
              )}
            </div>

            {/* SATELLITE MAP UNDER THE LATITUDE/LONGITUDE BOX */}
            <div className="er-satellite-map er-side-satellite-map">
              <div className="er-map-heading">
                <span>🛰️</span>
                <div>
                  <strong>Satellite location</strong>
                  <small>Satellite view of your current position</small>
                </div>
              </div>
              <LiveLocationMap
                mapTypeId="satellite"
                zoom={16}
                height={240}
                onLocationChange={handleMapLocation}
              />
              {coords && (
                <a
                  className="er-google-link"
                  href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open location in Google Maps ↗
                </a>
              )}
            </div>
          </div>
        </div>

        <p className="er-bottom-note">
          Your report is sent securely to the AidFlow Control Room for response coordination.
        </p>
      </main>
    </div>
    <Footer />
    </>
  )
}