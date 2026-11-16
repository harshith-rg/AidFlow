import { useEffect, useRef, useState } from 'react'
import './HeroAnimation.css'

/*
  Hero background: a looping, self-contained SVG animation of the AidFlow story.
    1. An emergency request appears on the map.
    2. Nearby ambulances are contacted one at a time (no response, rejected, accepted).
    3. The accepted ambulance drives to the patient.
    4. It then heads to a hospital.
  It is an ILLUSTRATION (no real data, no network requests, no video file).
  Animation uses SVG SMIL, so it needs no libraries. Reduced-motion users get a still frame.
*/

const DUR = 15 // seconds for one full loop
type Frames = [number, string | number][]

// One <animate> driven by [timeInSeconds, value] pairs on the shared 15 s timeline.
function Anim({ attr, frames }: { attr: string; frames: Frames }) {
  return (
    <animate
      attributeName={attr}
      values={frames.map((f) => f[1]).join(';')}
      keyTimes={frames.map((f) => (f[0] / DUR).toFixed(4)).join(';')}
      dur={`${DUR}s`}
      repeatCount="indefinite"
    />
  )
}

// Visible between a and b (seconds), with a short fade in/out.
const win = (a: number, b: number, peak = 1, fade = 0.3): Frames => [
  [0, 0],
  [a, 0],
  [a + fade, peak],
  [b, peak],
  [b + fade, 0],
  [DUR, 0],
]

// ── Map layout (viewBox 1600 x 900) ─────────────────────────────────────────
const ROAD_X = [200, 440, 680, 920, 1160, 1400]
const ROAD_Y = [140, 300, 460, 620, 780]

const START = { x: 200, y: 780 } // chosen ambulance
const PATIENT = { x: 440, y: 300 }
const HOSPITAL = { x: 1160, y: 140 }
const CAND_1 = { x: 920, y: 620 } // does not respond
const CAND_2 = { x: 1400, y: 460 } // rejects

// Rounded-corner road route, split at the patient so each leg can be drawn separately.
const LEG1 = 'M200 780 H390 A50 50 0 0 0 440 730 V300'
const LEG2 = 'M440 300 V190 A50 50 0 0 1 490 140 H1160'
const FULL = 'M200 780 H390 A50 50 0 0 0 440 730 V190 A50 50 0 0 1 490 140 H1160'
const L1 = 190 + (Math.PI * 50) / 4 + 430
const L2 = 110 + (Math.PI * 50) / 4 + 670
const PICKUP = (L1 / (L1 + L2)).toFixed(4)

// Timeline (seconds)
const T = { offer1: 1.2, offer2: 2.6, offer3: 3.8, go: 4.6, pickup: 8.6, leave: 9.6, arrive: 13.6, end: 14.4 }

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

function AmbulanceIcon({ blink = false, dim = false }: { blink?: boolean; dim?: boolean }) {
  return (
    <g opacity={dim ? 0.8 : 1}>
      {blink && (
        <>
          <circle r="36" fill="#ef4444" opacity="0">
            <animate attributeName="opacity" values="0.4;0;0.4" dur="0.8s" repeatCount="indefinite" />
          </circle>
          <circle r="36" fill="#38bdf8" opacity="0">
            <animate attributeName="opacity" values="0;0.4;0" dur="0.8s" repeatCount="indefinite" />
          </circle>
        </>
      )}
      <rect x="-24" y="-11" width="48" height="22" rx="5" fill="#f1f5f9" />
      <rect x="9" y="-9" width="11" height="18" rx="3" fill="#38bdf8" opacity="0.85" />
      <path d="M-12 -6V6M-18 0H-6" stroke="#ef4444" strokeWidth="4" strokeLinecap="round" />
      <rect x="-2" y="-12" width="5" height="9" rx="1.5" fill="#ef4444" />
      <rect x="-2" y="3" width="5" height="9" rx="1.5" fill="#38bdf8" />
    </g>
  )
}

function Leg({ d, color, from, to }: { d: string; color: string; from: number; to: number }) {
  const frames: Frames = [
    [0, 1],
    [from, 1],
    [to, 0],
    [DUR, 0],
  ]
  return (
    <>
      <path d={d} pathLength={1} strokeDasharray="1" strokeDashoffset="1" fill="none" stroke={color}
        strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" filter="url(#af-glow)">
        <Anim attr="stroke-dashoffset" frames={frames} />
      </path>
      <path d={d} pathLength={1} strokeDasharray="1" strokeDashoffset="1" fill="none" stroke={color}
        strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <Anim attr="stroke-dashoffset" frames={frames} />
      </path>
    </>
  )
}

function Offer({ to, color, a, b }: { to: { x: number; y: number }; color: string; a: number; b: number }) {
  return (
    <>
      <line x1={PATIENT.x} y1={PATIENT.y} x2={to.x} y2={to.y} stroke={color} strokeWidth="3"
        strokeDasharray="10 10" strokeLinecap="round" opacity="0">
        <Anim attr="opacity" frames={win(a, b, 0.9)} />
        <animate attributeName="stroke-dashoffset" from="0" to="-40" dur="0.8s" repeatCount="indefinite" />
      </line>
      <circle cx={PATIENT.x} cy={PATIENT.y} r="0" fill="none" stroke={color} strokeWidth="3" opacity="0">
        <Anim attr="r" frames={[[0, 0], [a, 0], [a + 1, dist(PATIENT, to)], [DUR, dist(PATIENT, to)]]} />
        <Anim attr="opacity" frames={[[0, 0], [a, 0], [a + 0.05, 0.8], [a + 1, 0], [DUR, 0]]} />
      </circle>
    </>
  )
}

function Tag({ x, y, text, color, a, b }: { x: number; y: number; text: string; color: string; a: number; b: number }) {
  return (
    <text x={x} y={y + 56} textAnchor="middle" fill={color} fontSize="20" fontWeight="600"
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" letterSpacing="1" opacity="0">
      <Anim attr="opacity" frames={win(a, b)} />
      {text}
    </text>
  )
}

function Status({ text, a, b }: { text: string; a: number; b: number }) {
  return (
    <text x="64" y="848" fill="#cbd5e1" fontSize="24" letterSpacing="2"
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" opacity="0">
      <Anim attr="opacity" frames={win(a, b - 0.3)} />
      {text.toUpperCase()}
    </text>
  )
}

export default function HeroAnimation() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-aspect-ratio: 1/1)').matches,
  )

  // Phones in portrait: show the whole scene instead of cropping its sides.
  useEffect(() => {
    const mq = window.matchMedia('(max-aspect-ratio: 1/1)')
    const onChange = () => setPortrait(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Respect "reduce motion": freeze on a complete still frame.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      if (mq.matches) {
        svg.pauseAnimations()
        svg.setCurrentTime(13.9)
      } else {
        svg.unpauseAnimations()
      }
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return (
    <div className="hero-video hero-anim" aria-hidden="true">
      <svg ref={svgRef} viewBox="0 0 1600 900" preserveAspectRatio={portrait ? 'xMidYMid meet' : 'xMidYMid slice'}
        xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="af-grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M80 0H0V80" fill="none" stroke="rgba(56,189,248,0.11)" strokeWidth="1" />
          </pattern>
          <filter id="af-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* ── Map: grid + road network ── */}
        <rect x="-2000" y="-2000" width="5600" height="4900" fill="url(#af-grid)" />
        {ROAD_X.map((x) => (
          <g key={`x${x}`}>
            <line x1={x} y1="-2000" x2={x} y2="2900" stroke="rgba(148,163,184,0.22)" strokeWidth="16" />
            <line x1={x} y1="-2000" x2={x} y2="2900" stroke="rgba(255,255,255,0.14)" strokeWidth="2" strokeDasharray="16 16" />
          </g>
        ))}
        {ROAD_Y.map((y) => (
          <g key={`y${y}`}>
            <line x1="-2000" y1={y} x2="3600" y2={y} stroke="rgba(148,163,184,0.22)" strokeWidth="16" />
            <line x1="-2000" y1={y} x2="3600" y2={y} stroke="rgba(255,255,255,0.14)" strokeWidth="2" strokeDasharray="16 16" />
          </g>
        ))}

        {/* ── Always-on: hospital + two other ambulances ── */}
        <g transform={`translate(${HOSPITAL.x} ${HOSPITAL.y})`}>
          <circle r="34" fill="none" stroke="#38bdf8" strokeWidth="2" opacity="0.4">
            <animate attributeName="r" values="34;70" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.45;0" dur="3s" repeatCount="indefinite" />
          </circle>
          <circle r="34" fill="none" stroke="#34d399" strokeWidth="4" opacity="0">
            <Anim attr="r" frames={[[0, 34], [T.arrive, 34], [T.end + 0.2, 100], [DUR, 100]]} />
            <Anim attr="opacity" frames={[[0, 0], [T.arrive, 0], [T.arrive + 0.1, 0.8], [T.end + 0.2, 0], [DUR, 0]]} />
          </circle>
          <rect x="-34" y="-34" width="68" height="68" rx="14" fill="rgba(8,24,44,0.9)" stroke="#38bdf8" strokeWidth="3" />
          <path d="M0 -16V16M-16 0H16" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" />
        </g>
        <g transform={`translate(${CAND_1.x} ${CAND_1.y})`}><AmbulanceIcon dim /></g>
        <g transform={`translate(${CAND_2.x} ${CAND_2.y}) rotate(90)`}><AmbulanceIcon dim /></g>

        {/* ── Story layer (fades out and restarts each loop) ── */}
        <g opacity="0">
          <Anim attr="opacity" frames={[[0, 0], [0.5, 1], [T.end, 1], [DUR, 0]]} />

          {/* Dispatch: contact ambulances one at a time */}
          <Offer to={CAND_1} color="#fbbf24" a={T.offer1} b={T.offer2 - 0.2} />
          <Offer to={CAND_2} color="#f87171" a={T.offer2} b={T.offer3 - 0.2} />
          <Offer to={START} color="#34d399" a={T.offer3} b={T.go} />
          <Tag x={CAND_1.x} y={CAND_1.y} text="No response" color="#fbbf24" a={2.0} b={3.6} />
          <Tag x={CAND_2.x} y={CAND_2.y} text="Rejected" color="#f87171" a={3.2} b={4.6} />
          <Tag x={START.x} y={START.y} text="Accepted" color="#34d399" a={4.2} b={6.2} />

          {/* Routes draw themselves as the ambulance drives */}
          <Leg d={LEG1} color="#38bdf8" from={T.go} to={T.pickup} />
          <Leg d={LEG2} color="#34d399" from={T.leave} to={T.arrive} />

          {/* Patient */}
          <g transform={`translate(${PATIENT.x} ${PATIENT.y})`} opacity="0">
            <Anim attr="opacity" frames={[[0, 0], [0.4, 1], [T.pickup, 1], [T.pickup + 0.6, 0.3], [DUR, 0.3]]} />
            <circle r="10" fill="none" stroke="#ff4545" strokeWidth="3">
              <animate attributeName="r" values="10;74" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0" dur="2.2s" repeatCount="indefinite" />
            </circle>
            <circle r="10" fill="none" stroke="#ff4545" strokeWidth="3">
              <animate attributeName="r" values="10;74" dur="2.2s" begin="1.1s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0" dur="2.2s" begin="1.1s" repeatCount="indefinite" />
            </circle>
            <circle r="11" fill="#ff4545" stroke="#fff" strokeWidth="3">
              <Anim attr="fill" frames={[[0, '#ff4545'], [T.pickup, '#ff4545'], [T.pickup + 0.6, '#34d399'], [DUR, '#34d399']]} />
            </circle>
          </g>

          {/* The responding ambulance: waits, drives to patient, pauses, drives to hospital */}
          <g>
            <animateMotion
              path={FULL}
              dur={`${DUR}s`}
              repeatCount="indefinite"
              rotate="auto"
              calcMode="linear"
              keyPoints={`0;0;${PICKUP};${PICKUP};1;1`}
              keyTimes={[0, T.go, T.pickup, T.leave, T.arrive, DUR].map((t) => (t / DUR).toFixed(4)).join(';')}
            />
            <AmbulanceIcon blink />
          </g>

          {/* Status line (hidden on narrow portrait screens, where it would be too small to read) */}
          {!portrait && (
            <>
              <Status text="Emergency request received" a={0.5} b={1.3} />
              <Status text="Finding the nearest available ambulance" a={1.3} b={T.go} />
              <Status text="Ambulance on the way to the patient" a={T.go} b={T.leave} />
              <Status text="Heading to a suitable hospital" a={T.leave} b={T.end} />
            </>
          )}
        </g>

        {!portrait && (
          <text x="1536" y="848" textAnchor="end" fill="#94a3b8" fontSize="16" opacity="0.6"
            fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" letterSpacing="1">
            ILLUSTRATIVE ANIMATION
          </text>
        )}
      </svg>
    </div>
  )
}
