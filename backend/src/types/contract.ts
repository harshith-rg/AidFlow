// COPY of ../../src/types/contract.ts (frontend). Keep both files in sync; change names only after agreeing with Chiranthan.
// AidFlow API contract — agree these names with Member 2 (Hema) before building more.
// Coordinates: latitude/longitude in decimal degrees. Timestamps: ISO 8601 (UTC).

export type CaseStatus =
  | 'waiting'
  | 'offered'
  | 'assigned'
  | 'en_route'
  | 'reached_patient'
  | 'heading_to_hospital'
  | 'handed_over'
  | 'completed'
  | 'cancelled'

export type AttemptOutcome = 'pending' | 'accepted' | 'rejected' | 'timed_out'
export type Severity = 'critical' | 'high' | 'medium'
export type Role = 'patient' | 'driver' | 'hospital' | 'admin'

export const EMERGENCY_TYPES = [
  { id: 'cardiac', label: 'Cardiac Emergency', emoji: '❤️', severity: 'critical' },
  { id: 'accident', label: 'Road Accident', emoji: '🚗', severity: 'high' },
  { id: 'fire', label: 'Fire Emergency', emoji: '🔥', severity: 'critical' },
  { id: 'breathing', label: 'Breathing Difficulty', emoji: '🫁', severity: 'high' },
  { id: 'stroke', label: 'Stroke', emoji: '🧠', severity: 'critical' },
  { id: 'trauma', label: 'Physical Trauma', emoji: '🩹', severity: 'high' },
  { id: 'poisoning', label: 'Poisoning', emoji: '☠️', severity: 'high' },
  { id: 'burn', label: 'Burn Injury', emoji: '🔥', severity: 'medium' },
  { id: 'fracture', label: 'Fall / Fracture', emoji: '🦴', severity: 'medium' },
  { id: 'other', label: 'Other Emergency', emoji: '➕', severity: 'medium' },
] as const

export type EmergencyTypeId = (typeof EMERGENCY_TYPES)[number]['id']

export interface LatLng {
  lat: number
  lng: number
}

export interface Hospital extends LatLng {
  id: string
  name: string
  address?: string
  phone?: string
  category?: string
  capacityStatus: 'unknown' | 'available' | 'limited' | 'full'
  beds?: number
  icuBeds?: number
  lastUpdated?: string
}

export interface AssignedAmbulance {
  id: string
  label: string
  vehicleNumber: string
  driverFirstName: string
  isTest?: boolean // true for demo/test units
  lat?: number
  lng?: number
  lastLocationAt?: string
}

export interface StatusEvent {
  status: CaseStatus
  at: string // ISO 8601
}

export interface EmergencyCase {
  id: string // server-generated, e.g. "EMG-2026-0001"
  type: EmergencyTypeId
  severity: Severity
  reporterName: string
  reporterPhone: string
  description?: string
  pickup: LatLng & { address?: string }
  status: CaseStatus
  ambulance?: AssignedAmbulance
  hospital?: Hospital
  hospitalReason?: string // why this hospital was recommended
  etaMinutes?: number // ESTIMATE only — no live traffic
  createdAt: string
  history: StatusEvent[]
  cancelReason?: string
  isDemo?: boolean // true when produced by the mock API
  source?: 'web' | 'call' | 'manual' | 'ai_call'
  callSessionId?: string
}

export interface CreateEmergencyInput {
  type: EmergencyTypeId
  reporterName: string
  reporterPhone: string
  description?: string
  pickup: LatLng & { address?: string }
}

export interface DispatchAttempt {
  id: string
  caseId: string
  ambulanceId: string
  offeredAt: string
  expiresAt: string // countdown is DISPLAY only; the server enforces the timeout
  outcome: AttemptOutcome
}

export interface Ambulance extends Partial<LatLng> {
  id: string
  label: string
  status: 'available' | 'busy' | 'offline'
  lastSeen?: string
}

export interface AlertItem {
  id: string
  type: 'dispatch' | 'hospital' | 'system' | 'no_ambulance'
  message: string
  caseId?: string
  createdAt: string
  acknowledged: boolean
}

export const ACTIVE_STATUSES: CaseStatus[] = [
  'waiting',
  'offered',
  'assigned',
  'en_route',
  'reached_patient',
  'heading_to_hospital',
]
