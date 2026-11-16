export default function AISection() {
  return (
    <section className="ai-section" id="about">
      <div className="wrap ai-grid">
        <div className="ai-copy">
          <div className="eyebrow">Intelligent Emergency Coordination</div>
          <h2>AI-assisted, not AI-diagnosed.</h2>
          <p>
            AidFlow uses AI-assisted classification, location intelligence and hospital
            suitability analysis to support emergency-response coordination.
          </p>
        </div>
        <div className="ai-features">
          <div className="ai-feature glass">
            <div className="dot" />
            <span>AI-Assisted Emergency Classification</span>
          </div>
          <div className="ai-feature glass">
            <div className="dot" />
            <span>Intelligent Ambulance Dispatch</span>
          </div>
          <div className="ai-feature glass">
            <div className="dot" />
            <span>Hospital Suitability Recommendation</span>
          </div>
        </div>
      </div>
    </section>
  )
}
