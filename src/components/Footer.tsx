import Logo from './Logo'

export default function Footer() {
  return (
    <footer>
      <div className="wrap">

        {/* Footer Top */}
        <div className="foot-top">

          {/* AidFlow Branding */}
          <div className="brand">
            <Logo size={26} />

            <div>
              <span style={{ fontWeight: 600 }}>
                AidFlow
              </span>

              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--muted)',
                }}
              >
                AI-Powered Emergency Response
              </div>
            </div>
          </div>

          {/* Bottom Navigation */}
          <div className="foot-links">

            <a href="#home">
              Home
            </a>

            <a href="#how">
              How It Works
            </a>

            <a href="#about">
              About
            </a>

          </div>
        </div>

        {/* Copyright */}
        <div className="foot-bottom">
          <span>
            © 2026 AidFlow
          </span>

          <span>
            Student Research Prototype
          </span>
        </div>

      </div>
    </footer>
  )
}