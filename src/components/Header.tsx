import { Link } from 'react-router-dom'
import Logo from './Logo'

const baseOperations = [
  { to: '/emergency', label: 'Report Emergency' },
  { to: '/control-room', label: 'Control Room' },
]

export default function Header() {
  return (
    <header>
      <nav className="nav glass aidflow-nav">
        <Link to="/" className="brand" aria-label="AidFlow home">
          <Logo />
          <span>AidFlow</span>
        </Link>
        <div className="aidflow-operations-nav" aria-label="AidFlow operations">
          {baseOperations.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={item.to === '/control-room' ? 'aidflow-control-link' : ''}
            >
              {item.label}
            </Link>
          ))}


        </div>
      </nav>
      <style>{`
        .aidflow-nav { flex-wrap: wrap; gap: 12px; padding: 14px 18px; }
        .aidflow-operations-nav { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
        .aidflow-operations-nav a { display:inline-flex; align-items:center; justify-content:center; padding:9px 11px; border:1px solid rgba(125,211,252,.18); border-radius:9px; color:#cbd5e1; font-size:.82rem; font-weight:600; text-decoration:none; transition:background .18s ease,color .18s ease,border-color .18s ease; }
        .aidflow-operations-nav a:hover { color:#fff; background:rgba(56,189,248,.12); border-color:rgba(56,189,248,.55); }
        .aidflow-operations-nav .aidflow-control-link { background:#e11d2e; color:#fff; border-color:#e11d2e; box-shadow:0 4px 18px rgba(225,29,46,.2); }
        .aidflow-operations-nav .aidflow-control-link:hover { background:#c81527; border-color:#c81527; }
        @media(max-width:700px) { .aidflow-nav { align-items:flex-start; } .aidflow-operations-nav { width:100%; } .aidflow-operations-nav a { flex:1 1 auto; } }
      `}</style>
    </header>
  )
}
