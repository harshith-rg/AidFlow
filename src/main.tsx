import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AICallScreen from './components/AICallScreen'
import App from './App'
import ReportEmergency from './pages/ReportEmergency'
import TrackCase from './pages/TrackCase'
import ControlRoom from './pages/ControlRoom'
import HospitalsPage from './pages/HospitalsPage'
import { AlertsPage, DeliveryPatrol, LiveTracking } from './pages/OperationsPages'
import './index.css'

// Each Vite instance is intentionally isolated: the user app cannot render
// Control Room routes, and the Control Room app cannot render the public site.
const isControlRoomApp = import.meta.env.VITE_APP_ROLE === 'control-room'

const controlRoomRoutes = (
  <Routes>
    <Route path="/" element={<Navigate to="/control-room" replace />} />
    <Route path="/control-room" element={<ControlRoom />} />
    <Route path="/delivery-patrol" element={<DeliveryPatrol />} />
    <Route path="/hospitals" element={<HospitalsPage />} />
    <Route path="/live-tracking" element={<LiveTracking />} />
    <Route path="/alerts" element={<AlertsPage />} />
    <Route path="*" element={<Navigate to="/control-room" replace />} />
  </Routes>
)

const userRoutes = (
  <Routes>
    <Route path="/" element={<App />} />
    <Route path="/emergency" element={<AICallScreen />} />
    <Route path="/emergency/accessibility" element={<ReportEmergency />} />
    <Route path="/track/:caseId" element={<TrackCase />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {isControlRoomApp ? controlRoomRoutes : userRoutes}
    </BrowserRouter>
  </React.StrictMode>,
)
