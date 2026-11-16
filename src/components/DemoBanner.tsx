import { isMock } from '../api/client'

// Shown on every screen while the app runs on mock (demo) data.
export default function DemoBanner() {
  if (!isMock) return null
  return (
    <div className="af-demo-banner" role="note">
      <strong>DEMO MODE</strong> — prototype using demo data. No real ambulance or hospital is
      contacted. In a real emergency call <a href="tel:108">108</a> or{' '}
      <a href="tel:112">112</a>.
    </div>
  )
}
