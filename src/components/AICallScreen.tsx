import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type AICallFinalize, type AICallSlots } from '../api/client'
import AICallMap, { type Position } from './AICallMap'
import './AICallScreen.css'

const DEMO_NUMBER = '1800-000-0000'
const SPECIAL_CONTEXT_OPTIONS = [
  { label: 'Road accident', icon: '🚘', color: 'blue' },
  { label: 'Heart attack / chest pain', icon: '💗', color: 'red' },
  { label: 'Breathing difficulty', icon: '🫁', color: 'teal' },
  { label: 'Stroke symptoms', icon: '🧠', color: 'purple' },
  { label: 'Severe bleeding', icon: '🩸', color: 'rose' },
  { label: 'Burns / fire', icon: '🔥', color: 'orange' },
  { label: 'Fall / fracture', icon: '🦴', color: 'amber' },
  { label: 'Seizure', icon: '⚡', color: 'violet' },
  { label: 'Pregnancy emergency', icon: '🤰', color: 'pink' },
  { label: 'Poisoning', icon: '☣️', color: 'green' },
  { label: 'Other emergency', icon: '🚨', color: 'slate' },
] as const
type LocStatus = 'detecting' | 'ok' | 'denied' | 'unsupported'
type Phase = 'ready' | 'ringing' | 'active' | 'finalized' | 'error'
type Caption = { speaker: 'AI' | 'You'; text: string; at: string }
type RecognitionResult = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }
type RecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives?: number
  onresult: ((event: RecognitionResult) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void; stop: () => void
}
declare global {
  interface Window {
    SpeechRecognition?: new () => RecognitionLike
    webkitSpeechRecognition?: new () => RecognitionLike
  }
}

function coreDetailsCount(slots: AICallSlots): number {
  return [
    Boolean(slots.type),
    slots.conscious !== undefined,
    slots.breathing !== undefined,
    Boolean(slots.callerName?.trim()),
    /^\d{10}$/.test(slots.callerPhone ?? ''),
    Boolean(slots.specialContext),
    typeof slots.lat === 'number' && Number.isFinite(slots.lat) &&
      typeof slots.lng === 'number' && Number.isFinite(slots.lng),
  ].filter(Boolean).length
}

function hasCoreEmergencyDetails(slots: AICallSlots): boolean {
  return coreDetailsCount(slots) === 7
}

export default function AICallScreen() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('ready')
  const [sessionId, setSessionId] = useState('')
  const [captions, setCaptions] = useState<Caption[]>([])
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [silentPrompts, setSilentPrompts] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AICallFinalize | null>(null)
  const [slots, setSlots] = useState<AICallSlots>({})
  const recognition = useRef<RecognitionLike | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const locationRef = useRef<{lat:number;lng:number} | undefined>(undefined)
  const watchId = useRef<number | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const [locStatus, setLocStatus] = useState<LocStatus>('detecting')
  const sendingRef = useRef(false)

  const addCaption = useCallback((speaker: Caption['speaker'], text: string) => {
    setCaptions((old) => [...old, { speaker, text, at: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) }])
  }, [])

  const speak = useCallback((text: string) => {
    if (muted || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.94
    utterance.pitch = 1
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }, [muted])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [captions])

  useEffect(() => () => {
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current)
    recognition.current?.stop()
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

  // Silence handling: re-prompt twice at 10-second intervals, then finalize with
  // partial slots only when GPS is known; otherwise mark the simulated call failed.
  useEffect(() => {
    const last = captions[captions.length - 1]
    if (phase !== 'active' || speaking || listening || !sessionId || last?.speaker !== 'AI') return
    const timer = window.setTimeout(async () => {
      if (silentPrompts < 2) {
        setSilentPrompts(count => count + 1)
        const reminder = 'I am still here. Please answer the question so I can continue.'
        addCaption('AI', reminder)
        speak(reminder)
        return
      }
      if (locationRef.current) {
        const reminder = 'I still need the remaining details before I can register the emergency. Please use the microphone or type your answer. You can also end the demo call without submitting.'
        addCaption('AI', reminder)
        speak(reminder)
      } else {
        await api.abandonAICall(sessionId).catch(() => undefined)
        setSessionId('')
        setPhase('error')
        setError('The call ended after two reminders because your location could not be detected. Please allow location access in your browser and start again.')
      }
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [phase, speaking, listening, captions, silentPrompts, sessionId, addCaption, speak])

  const applyFix = useCallback((p: GeolocationPosition) => {
    const next = { lat: p.coords.latitude, lng: p.coords.longitude }
    locationRef.current = next
    setPosition({ ...next, accuracy: p.coords.accuracy })
    setLocStatus('ok')
  }, [])

  // Detects the device location automatically and keeps it updated while the call is open.
  const startLocationWatch = useCallback(() => {
    if (!navigator.geolocation) { setLocStatus('unsupported'); return }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    setLocStatus('detecting')
    watchId.current = navigator.geolocation.watchPosition(
      applyFix,
      (err) => { if (!locationRef.current) setLocStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'detecting') },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    )
  }, [applyFix])

  const getLocation = () => new Promise<{lat:number;lng:number} | undefined>((resolve) => {
    if (!navigator.geolocation) return resolve(undefined)
    navigator.geolocation.getCurrentPosition(
      p => { applyFix(p); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }) },
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 },
    )
  })

  const playRingTone = () => {
    try {
      const AudioContextCtor = window.AudioContext
      if (!AudioContextCtor) return
      const context = new AudioContextCtor()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 440
      gain.gain.value = 0.035
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      window.setTimeout(() => {
        oscillator.stop()
        void context.close()
      }, 850)
    } catch { /* sound is optional; visual ringing remains */ }
  }

  const beginCall = async () => {
    setError('')
    setCaptions([])
    setSlots({})
    setResult(null)
    setSilentPrompts(0)
    playRingTone()
    setPhase('ringing')
    // This is a simulated browser call only. No telephone network is contacted.
    startLocationWatch()
    // Start the AI session immediately; GPS resolution must not delay the call screen.
    void getLocation().then((location) => {
      if (!location) return
      locationRef.current = location
      setPosition((current) => ({ ...location, accuracy: current?.accuracy }))
    })
    try {
      const started = await api.startAICall({ language: 'en-IN' })
      setSessionId(started.sessionId)
      addCaption('AI', started.greeting)
      setPhase('active')
      speak(started.greeting)
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Could not start the demo call.')
    }
  }

  const stopAgentSpeech = useCallback(() => {
    // Let callers interrupt long spoken prompts and answer immediately.
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  const sendTurn = async (raw: string, silent = false) => {
    const text = raw.trim()
    if ((!text && !silent) || !sessionId || sendingRef.current || phase !== 'active') return
    if (!silent) stopAgentSpeech()
    sendingRef.current = true
    if (!silent) {
      setInput('')
      setSilentPrompts(0)
      setListening(false)
      recognition.current?.stop()
      addCaption('You', text)
    }
    try {
      const turn = await api.sendAICallTurn(sessionId, text, locationRef.current)
      setSlots(turn.slots)
      if (turn.done || hasCoreEmergencyDetails(turn.slots)) {
        recognition.current?.stop()
        setListening(false)
        const final = await api.finalizeAICall(sessionId, true)
        setResult(final)
        setPhase('finalized')
        addCaption('AI', final.agentClosingMessage)
        speak(final.agentClosingMessage)
      } else if (!silent) {
        addCaption('AI', turn.agentReply)
        speak(turn.agentReply)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The AI assistant could not process that response.')
    } finally {
      sendingRef.current = false
    }
  }

  // As soon as the device location is known and the call does not have it yet, send it silently.
  useEffect(() => {
    if (phase === 'active' && sessionId && position && !slots.lat) void sendTurn('', true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sessionId, position, slots.lat])

  useEffect(() => {
    if (muted && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [muted])

  const startListening = () => {
    // Start listening right away; do not wait for the AI voice prompt to finish.
    stopAgentSpeech()
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser. Use the text box below instead.')
      return
    }
    setError('')
    const rec = new SpeechRecognition()
    recognition.current = rec
    rec.lang = 'en-IN'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 3
    rec.onresult = (event) => {
      const all = Array.from(event.results)
      const finalText = all.filter((item) => item.isFinal).map((item) => item[0]?.transcript ?? '').join(' ').trim()
      const interimText = all.map((item) => item[0]?.transcript ?? '').join(' ').trim()
      if (finalText || interimText) setInput(finalText || interimText)
      if (finalText) {
        // Submit finalized speech immediately; this interrupts any spoken prompt.
        setListening(false)
        rec.stop()
        void sendTurn(finalText)
      }
    }
    rec.onerror = () => { setListening(false); setError('Microphone access was unavailable. You can type your answer instead.') }
    rec.onend = () => setListening(false)
    try { rec.start(); setListening(true) } catch { setListening(false); setError('Could not start the microphone. Please use text input.') }
  }

  const endCall = () => {
    if (watchId.current !== null && navigator.geolocation) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null }
    setPosition(null)
    setLocStatus('detecting')
    locationRef.current = undefined
    if (sessionId) void api.abandonAICall(sessionId).catch(() => undefined)
    recognition.current?.stop()
    setListening(false)
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setSpeaking(false)
    setPhase('ready')
    setSessionId('')
    setCaptions([])
    setSlots({})
    setResult(null)
    setError('')
  }

  const hangUp = async () => {
    if (sessionId && hasCoreEmergencyDetails(slots) && phase === 'active') {
      try {
        recognition.current?.stop()
        setListening(false)
        const final = await api.finalizeAICall(sessionId, true)
        setResult(final)
        setPhase('finalized')
        addCaption('AI', final.agentClosingMessage)
        speak(final.agentClosingMessage)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The emergency report could not be registered.')
      }
      return
    }
    endCall()
  }

  const isLive = phase === 'active'
  const collectedCoreDetails = coreDetailsCount(slots)
  // Render the quick-response choices as soon as the assistant asks for
  // special context. Do not gate this UI on the phone/GPS slot validation:
  // those checks previously hid the buttons even while the prompt was visible.
  const choosingContext = phase === 'active' &&
    !slots.specialContext &&
    captions.some((caption) =>
      caption.speaker === 'AI' &&
      /select any of the options|special context/i.test(caption.text)
    )

  return (
    <main className="ai-call-page">
      <div className="ai-call-heading">
        <span className="ai-call-eyebrow">AIDFLOW · AI EMERGENCY HELPLINE</span>
        <h1>Talk to our AI assistant</h1>
        <p>A simulated browser call that collects emergency details and prepares a demo response.</p>
      </div>
      <div className={`ai-call-wrap ${isLive ? 'is-live' : ''}`}>
        {phase === 'ready' || phase === 'ringing' || phase === 'error' ? (
          <section className="ai-dial-card">
            <Link to="/" className="ai-call-back">← Back to AidFlow</Link>
            <div className="ai-demo-tag"><span/> SIMULATED CALL ONLY</div>
            <div className="ai-phone-icon">☎</div>
            <div className="ai-dial-label">DEMO HELPLINE NUMBER</div>
            <div className="ai-dial-number">{DEMO_NUMBER}</div>
            <p className="ai-dial-note">This number is for the AidFlow project demonstration. It does not connect to a telephone network.</p>
            {phase === 'ringing' ? (
              <div className="ai-ringing"><span className="ai-ring-pulse"/> Ringing the demo helpline…</div>
            ) : (
              <button className="ai-call-button" type="button" onClick={beginCall}>☎ &nbsp; Call emergency service</button>
            )}
            {error && <p className="ai-call-error" role="alert">{error}</p>}
            <Link className="ai-accessibility-link" to="/emergency/accessibility">Accessibility / can't talk? Use the emergency form</Link>
          </section>
        ) : phase === 'finalized' && result ? (
          <section className="ai-final-card">
            <Link to="/" className="ai-call-back">← Back to AidFlow</Link>
            <div className="ai-success-icon">✓</div>
            <span className="ai-call-eyebrow">DEMO EMERGENCY REGISTERED</span>
            <h2>{result.caseCode}</h2>
            <p>Your details have been submitted to the AidFlow demo workflow.</p>
            <div className="ai-result-grid">
              <div><small>TRIAGE SEVERITY</small><strong className={`severity-${result.severity}`}>{result.severity.toUpperCase()}</strong></div>
              <div><small>ESTIMATED ARRIVAL</small><strong>{result.etaMinutes ? `${result.etaMinutes} min` : 'Pending'}</strong></div>
            </div>
            <p className="ai-closing">{result.agentClosingMessage}</p>
            <button className="ai-call-button" onClick={() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior }); navigate(`/track/${encodeURIComponent(result.caseCode)}`); }}>Open live tracking</button>
            <button className="ai-secondary-button" onClick={endCall}>Finish call</button>
            <p className="ai-smallprint">This is a simulated project workflow, not a live emergency service.</p>
          </section>
        ) : (
          <div className="ai-live-layout">
          <section className="ai-active-card">
            <Link to="/" className="ai-call-back">← Back to AidFlow</Link>
            <div className="ai-active-top">
              <div><span className="ai-live-dot"/> SIMULATED CALL IN PROGRESS</div>
              <span>{DEMO_NUMBER}</span>
            </div>
            <div className="ai-agent-avatar"><span>✦</span></div>
            <h2>AidFlow AI Assistant</h2>
            <p className="ai-agent-status">{speaking ? 'AI is speaking' : listening ? 'AI is listening' : 'AI is ready for your response'}</p>
            <div className={`ai-wave ${listening ? 'is-listening' : speaking ? 'is-speaking' : ''}`} aria-label="Microphone activity indicator">
              {Array.from({length:24},(_,i)=><i key={i} style={{'--bar': `${12 + ((i*17)%30)}px`} as React.CSSProperties}/>)}
            </div>
            <div className="ai-captions" ref={scrollRef} aria-live="polite">
              {captions.map((c,i)=><div className={`ai-caption ${c.speaker==='AI'?'from-ai':'from-user'}`} key={`${i}-${c.at}`}><small>{c.speaker==='AI'?'AIDFLOW AI':'YOU'} · {c.at}</small><p>{c.text}</p></div>)}
            </div>
            {choosingContext && (
              <section className="ai-context-picker">
                <h3>⚡ INSTANT EMERGENCY RESPONSE (CLICK OR SPEAK ANYTIME):</h3>
                <div className="ai-context-grid">
                  {SPECIAL_CONTEXT_OPTIONS.map((option) => (
                    <button key={option.label} type="button" className={`ai-context-option context-${option.color}`}
                      disabled={sendingRef.current} onClick={() => void sendTurn(option.label)}>
                      <span className="ai-context-number">{SPECIAL_CONTEXT_OPTIONS.indexOf(option) + 1}</span>
                      <span className="ai-context-emoji">{option.icon}</span>
                      <span className="ai-context-label">{option.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {locStatus === 'denied' && <button type="button" className="ai-location-retry" onClick={startLocationWatch}>⌖ Retry location detection</button>}
            <div className="ai-call-controls">
              <button type="button" className={`ai-control ${muted?'selected':''}`} onClick={()=>setMuted(v=>!v)}><span>◖</span>{muted?'Unmute AI voice':'Mute AI voice'}</button>
              <button type="button" className={`ai-control ${listening?'selected':''}`} onClick={listening?()=>recognition.current?.stop():startListening}><span>🎙</span>{listening?'Stop listening':'Speak answer'}</button>
              <button type="button" className="ai-control ai-end-control" onClick={hangUp}><span>✕</span>End call</button>
            </div>
            {!choosingContext && <form className="ai-text-entry" onSubmit={e=>{e.preventDefault();stopAgentSpeech();void sendTurn(input)}}>
              <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Or type your answer here…" aria-label="Type your answer"/>
              <button type="submit" disabled={!input.trim()}>Send</button>
            </form>}
            {error && <p className="ai-call-error" role="alert">{error}</p>}
            <div className="ai-collected"><span>Emergency details collected</span><small>{collectedCoreDetails} / 7 key details</small></div>
            <div className="ai-progress"><i style={{width:`${collectedCoreDetails * (100 / 7)}%`}}/></div>
            <p className="ai-accessibility-inline">Speak or type at any time, including while the AI is announcing categories. Finalized speech is submitted immediately and interrupts the announcement. This is a simulated demo and does not contact emergency services.</p>
          </section>
          <AICallMap position={position} status={locStatus} />
          </div>
        )}
      </div>
    </main>
  )
}
