import { useEffect, useRef, useState } from 'react'
import {
  emergencyStore,
  type EmergencyRecord,
  playAlertChime,
} from '../services/emergencyStore'
import './ControlRoomAlertToast.css'

interface Props {
  onViewDetails: (record: EmergencyRecord) => void
}

const SOUND_PREFERENCE_KEY = 'aidflow-control-room-alert-sound'
const TOAST_DURATION_MS = 9000

export default function ControlRoomAlertToast({ onViewDetails }: Props) {
  const [notifications, setNotifications] = useState<EmergencyRecord[]>([])
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(SOUND_PREFERENCE_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const soundEnabledRef = useRef(soundEnabled)
  const seenAlertIds = useRef<Set<string>>(new Set(emergencyStore.getUnacknowledgedIds()))
  const timers = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    soundEnabledRef.current = soundEnabled
    try {
      window.localStorage.setItem(SOUND_PREFERENCE_KEY, soundEnabled ? 'on' : 'off')
    } catch {
      // Sound preference is optional when browser storage is unavailable.
    }
  }, [soundEnabled])

  useEffect(() => {
    const unsubscribe = emergencyStore.subscribe(() => {
      const allRecords = emergencyStore.getEmergencies()
      const unacknowledged = new Set(emergencyStore.getUnacknowledgedIds())
      const freshAlerts = allRecords.filter(
        (record) =>
          unacknowledged.has(record.id) &&
          record.status === 'NEW' &&
          !seenAlertIds.current.has(record.id)
      )

      if (freshAlerts.length === 0) return

      freshAlerts.forEach((record) => seenAlertIds.current.add(record.id))
      setNotifications((current) => [...freshAlerts, ...current].slice(0, 3))

      // Play exactly once for each newly received emergency, not on every store refresh.
      if (soundEnabledRef.current) {
        freshAlerts.forEach(() => playAlertChime())
      }

      freshAlerts.forEach((record) => {
        const timer = window.setTimeout(() => {
          timers.current.delete(record.id)
          setNotifications((current) => current.filter((item) => item.id !== record.id))
        }, TOAST_DURATION_MS)
        timers.current.set(record.id, timer)
      })
    })

    return () => {
      unsubscribe()
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current.clear()
    }
  }, [])

  const dismissNotification = (id: string) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
    setNotifications((current) => current.filter((item) => item.id !== id))
  }

  const handleViewDetails = (record: EmergencyRecord) => {
    dismissNotification(record.id)
    emergencyStore.acknowledgeAlert(record.id)
    emergencyStore.updateEmergencyStatus(
      record.id,
      'ACKNOWLEDGED',
      'Acknowledged by Control Room Operator'
    )
    onViewDetails(record)
  }

  const toggleSound = () => {
    const nextValue = !soundEnabled
    soundEnabledRef.current = nextValue
    setSoundEnabled(nextValue)
    if (nextValue) playAlertChime()
  }

  return (
    <div className="af-toast-stack" aria-label="Incoming emergency notifications">
      {notifications.map((record) => (
        <section
          key={record.id}
          className={`af-emergency-toast af-emergency-toast--${record.severity.toLowerCase()}`}
          role="alert"
          aria-live="assertive"
        >
          <div className="af-toast-accent" />
          <div className="af-toast-content">
            <div className="af-toast-heading">
              <span className="af-toast-siren" aria-hidden="true">🚨</span>
              <div className="af-toast-heading-copy">
                <span className="af-toast-kicker">AIDFLOW · NEW ALERT</span>
                <strong>Emergency reported</strong>
              </div>
              <button
                type="button"
                className="af-toast-close"
                onClick={() => dismissNotification(record.id)}
                aria-label="Dismiss notification"
                title="Dismiss"
              >
                ×
              </button>
            </div>

            <div className="af-toast-details">
              <strong>{record.typeLabel}</strong>
              <span className={`af-toast-severity af-toast-severity--${record.severity.toLowerCase()}`}>
                {record.severity}
              </span>
            </div>
            <p className="af-toast-location">
              <span aria-hidden="true">📍</span>
              {record.location.address || 'Location shared with emergency report'}
            </p>
            <div className="af-toast-footer">
              <span className="af-toast-case-id">{record.id}</span>
              <button
                type="button"
                className="af-toast-view"
                onClick={() => handleViewDetails(record)}
              >
                View details
              </button>
            </div>
          </div>
        </section>
      ))}

      <button
        type="button"
        className={`af-toast-sound-toggle ${soundEnabled ? 'is-enabled' : 'is-muted'}`}
        onClick={toggleSound}
        aria-pressed={soundEnabled}
        title={soundEnabled ? 'Mute emergency alert sound' : 'Enable emergency alert sound'}
      >
        {soundEnabled ? '🔊 Sound on' : '🔇 Sound off'}
      </button>
    </div>
  )
}
