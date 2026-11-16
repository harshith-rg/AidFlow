export default function HowItWorks() {
  return (
    <section id="how">
      <div className="wrap">
        <div className="section-head">
          <div className="eyebrow">Real-World Inspired Workflow</div>
          <h2>From Emergency Report to Coordinated Response.</h2>
        </div>
        <div className="steps" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <div className="step">
            <div className="num">01</div>
            <h3>Report Emergency</h3>
            <p>
              A person submits the emergency type, contact details, description, and current GPS location through the User webpage.
            </p>
          </div>
          <div className="step">
            <div className="num">02</div>
            <h3>Emergency Report Intake</h3>
            <p>
              The shared backend stores the report and creates a case for the Control Room.
            </p>
          </div>
          <div className="step">
            <div className="num">03</div>
            <h3>Instant Control Alert</h3>
            <p>
              The Control Room receives a live alert and the incident appears in its case queue and Live Tracking map.
            </p>
          </div>
          <div className="step">
            <div className="num">04</div>
            <h3>Ambulance Dispatch</h3>
            <p>
              The Control Room reviews each report, assigns available support, and tracks response progress.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
