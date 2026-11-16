import { Link } from 'react-router-dom'
import FadeIn from './FadeIn'
import AnimatedHeading from './AnimatedHeading'
import Logo from './Logo'

export default function Hero() {
  return (
    <section className="hero" id="home">
      <video
        className="hero-video"
        src="/hero-city.mp4"
        poster="/hero-city-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      />

      <div className="hero-overlay" />

      <div className="hero-inner">
        <div className="hero-grid">
          {/* BRAND LOCKUP */}
          <div className="brand-lockup">
            <Logo className="hero-logo" />
            <div className="brand-name-group">
              <AnimatedHeading text="AidFlow" className="hero-h" />
              <FadeIn as="p" className="brand-subtitle" delay={700} duration={1000}>
                AI-Powered Emergency Response System
              </FadeIn>
            </div>
          </div>

          {/* DESCRIPTION */}
          <FadeIn as="p" className="sub" delay={1000} duration={1000}>
            A simple emergency reporting experience connected to a live Control Room for response coordination.
          </FadeIn>

          {/* PRIMARY SHORTCUTS — moved into the former reporting-card position */}
          <FadeIn as="div" className="hero-actions" delay={1200} duration={1000}>
            <Link to="/emergency" className="btn-emergency">
              🚨 Start AI emergency call
            </Link>
            <a href="#how" className="btn-secondary">
              Workflow Overview
            </a>
          </FadeIn>

          {/* ACADEMIC SAFETY MESSAGE */}
          <FadeIn as="p" className="safety-note" delay={1400} duration={1000}>
            Emergency report → Control Room alert → Response coordination.
          </FadeIn>
        </div>
      </div>

      <style>{`
        .hero-actions {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          margin: 22px 0 12px;
        }
        .safety-note { margin-top: 12px; }
        @media (max-width: 600px) {
          .hero-actions { flex-direction: column; width: 100%; }
          .hero-actions a { width: min(100%, 320px); justify-content: center; }
        }
      `}</style>
    </section>
  )
}
