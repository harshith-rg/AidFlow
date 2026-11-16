import hospitalDirectory from '../data/hospital_directory.json'
import { EMERGENCY_TYPES, type EmergencyTypeId } from '../types/contract'

export type EmergencyStatus =
  | 'NEW'
  | 'ACKNOWLEDGED'
  | 'AMBULANCE ASSIGNED'
  | 'DISPATCHED'
  | 'PATIENT PICKED UP'
  | 'COMPLETED'
  | 'CANCELLED'

export type EmergencySeverity = 'Critical' | 'High' | 'Moderate'

export interface CallerInfo {
  name: string
  phone: string
  relationship: string
  simulatedLocation?: string
}

export interface PatientInfo {
  name: string
  phone: string
  age?: number | string
  gender?: string
  count: number
}

export interface EmergencyLocation {
  address: string
  lat: number
  lng: number
  landmark?: string
}

export interface HospitalInfo {
  id: string
  name: string
  address: string
  distanceKm: number
  reason: string
  phone?: string
  beds?: number | null
  icuBeds?: number | null
}

export interface AmbulanceUnit {
  id: string
  label: string
  vehicleNumber: string
  driver: string
  driverPhone: string
  type: 'Advanced Life Support (ALS)' | 'Basic Life Support (BLS)' | 'Patient Transport'
  status: 'Available' | 'On assignment' | 'Offline'
  lat: number
  lng: number
  zone: string
}

export interface EmergencyRecord {
  id: string
  caller: CallerInfo
  patient: PatientInfo
  typeId: EmergencyTypeId
  typeLabel: string
  typeEmoji: string
  severity: EmergencySeverity
  medicalNotes: string
  symptoms: string[]
  specialAssistance: string[]
  location: EmergencyLocation
  hospital: HospitalInfo | null
  assignedAmbulance: AmbulanceUnit | null
  status: EmergencyStatus
  createdAt: string
  timeString: string
  acknowledgedAt?: string
  dispatchedAt?: string
  completedAt?: string
  history: Array<{ status: EmergencyStatus; at: string; note?: string }>
  isSimulatedMovementActive?: boolean
  simulatedProgress?: number // 0 to 100
  etaMinutes?: number
}

const STORAGE_KEY = 'aidflow-control-reports-v2'
const FLEET_STORAGE_KEY = 'aidflow-ambulance-fleet-v2'
const CHANNEL_NAME = 'aidflow_realtime_emergency_bus'

// Initial demo fleet
export const INITIAL_FLEET: AmbulanceUnit[] = [
  {
    id: 'AMB-01',
    label: 'Unit 01 - ALS Cardiac Care',
    vehicleNumber: 'KA-01-EA-1001',
    driver: 'Rajesh Kumar',
    driverPhone: '98765-12301',
    type: 'Advanced Life Support (ALS)',
    status: 'Available',
    lat: 12.9780,
    lng: 77.6010,
    zone: 'Central Bengaluru / MG Road',
  },
  {
    id: 'AMB-02',
    label: 'Unit 02 - ALS Trauma Response',
    vehicleNumber: 'KA-01-EA-1002',
    driver: 'Anil Deshmukh',
    driverPhone: '98765-12302',
    type: 'Advanced Life Support (ALS)',
    status: 'Available',
    lat: 12.9645,
    lng: 77.6385,
    zone: 'Indiranagar / East',
  },
  {
    id: 'AMB-03',
    label: 'Unit 03 - BLS Rapid Response',
    vehicleNumber: 'KA-01-EA-1003',
    driver: 'Sunil Gowda',
    driverPhone: '98765-12303',
    type: 'Basic Life Support (BLS)',
    status: 'Available',
    lat: 12.9290,
    lng: 77.5830,
    zone: 'Jayanagar / South',
  },
  {
    id: 'AMB-04',
    label: 'Unit 04 - ALS Intensive Care',
    vehicleNumber: 'KA-01-EA-1004',
    driver: 'Farhan Ali',
    driverPhone: '98765-12304',
    type: 'Advanced Life Support (ALS)',
    status: 'On assignment',
    lat: 12.9560,
    lng: 77.7120,
    zone: 'Whitefield Tech Corridor',
  },
  {
    id: 'AMB-05',
    label: 'Unit 05 - BLS Transit Unit',
    vehicleNumber: 'KA-01-EA-1005',
    driver: 'Praveen Nair',
    driverPhone: '98765-12305',
    type: 'Basic Life Support (BLS)',
    status: 'Available',
    lat: 13.0030,
    lng: 77.5690,
    zone: 'Malleshwaram / North',
  },
  {
    id: 'AMB-06',
    label: 'Unit 06 - BLS Suburban Response',
    vehicleNumber: 'KA-01-EA-1006',
    driver: 'Kiran Reddy',
    driverPhone: '98765-12306',
    type: 'Basic Life Support (BLS)',
    status: 'Offline',
    lat: 12.9120,
    lng: 77.6520,
    zone: 'HSR Layout / Outer Ring',
  },
  {
    id: 'AMB-07',
    label: 'Unit 07 - ALS Emergency Support',
    vehicleNumber: 'KA-01-EA-1007',
    driver: 'Demo Driver 07',
    driverPhone: '90000-00007',
    type: 'Advanced Life Support (ALS)',
    status: 'Available',
    lat: 12.9870,
    lng: 77.5700,
    zone: 'Rajajinagar / West',
  },
  {
    id: 'AMB-08',
    label: 'Unit 08 - BLS Rapid Response',
    vehicleNumber: 'KA-01-EA-1008',
    driver: 'Demo Driver 08',
    driverPhone: '90000-00008',
    type: 'Basic Life Support (BLS)',
    status: 'Available',
    lat: 12.9050,
    lng: 77.5850,
    zone: 'Banashankari / South',
  },
  {
    id: 'AMB-09',
    label: 'Unit 09 - ALS Trauma Care',
    vehicleNumber: 'KA-01-EA-1009',
    driver: 'Demo Driver 09',
    driverPhone: '90000-00009',
    type: 'Advanced Life Support (ALS)',
    status: 'Available',
    lat: 13.0350,
    lng: 77.5970,
    zone: 'Yeshwanthpur / North',
  },
  {
    id: 'AMB-10',
    label: 'Unit 10 - BLS Community Unit',
    vehicleNumber: 'KA-01-EA-1010',
    driver: 'Demo Driver 10',
    driverPhone: '90000-00010',
    type: 'Basic Life Support (BLS)',
    status: 'Available',
    lat: 12.9480,
    lng: 77.5500,
    zone: 'Vijayanagar / West',
  },
  {
    id: 'AMB-11',
    label: 'Unit 11 - ALS Cardiac Response',
    vehicleNumber: 'KA-01-EA-1011',
    driver: 'Demo Driver 11',
    driverPhone: '90000-00011',
    type: 'Advanced Life Support (ALS)',
    status: 'Available',
    lat: 12.9200,
    lng: 77.6100,
    zone: 'BTM / South-East',
  },
  {
    id: 'AMB-12',
    label: 'Unit 12 - BLS Transit Support',
    vehicleNumber: 'KA-01-EA-1012',
    driver: 'Demo Driver 12',
    driverPhone: '90000-00012',
    type: 'Basic Life Support (BLS)',
    status: 'Available',
    lat: 13.0100,
    lng: 77.6500,
    zone: 'Hebbal / North-East',
  },
]

// Seed emergencies for demo
export const INITIAL_EMERGENCIES: EmergencyRecord[] = [
  {
    id: 'AF-2026-0128',
    caller: { name: 'Vikram Joshi', phone: '98450-11223', relationship: 'Bystander' },
    patient: { name: 'Unknown Male', phone: '98450-11223', age: 34, gender: 'Male', count: 1 },
    typeId: 'accident',
    typeLabel: 'Road Accident',
    typeEmoji: '🚗',
    severity: 'Critical',
    medicalNotes: 'Two-wheeler collision with divider. Heavy bleeding from head, patient semi-conscious.',
    symptoms: ['Unconscious / unresponsive', 'Heavy Bleeding', 'Head Trauma'],
    specialAssistance: ['Oxygen support required', 'Spine board / Stretcher required'],
    location: { address: 'MG Road Metro Pillar 142, Bengaluru', lat: 12.9750, lng: 77.6070 },
    hospital: {
      id: 'hosp-1',
      name: 'Bowring and Lady Curzon Hospital',
      address: 'Lady Curzon Road, Tasker Town, Bengaluru',
      distanceKm: 1.4,
      reason: 'Nearest government trauma care center with emergency surgical unit (1.4 km)',
      phone: '080-25591325',
    },
    assignedAmbulance: null,
    status: 'NEW',
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    timeString: new Date(Date.now() - 1000 * 60 * 8).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    history: [
      { status: 'NEW', at: new Date(Date.now() - 1000 * 60 * 8).toISOString(), note: 'Emergency report received' },
    ],
  },
  {
    id: 'AF-2026-0127',
    caller: { name: 'Radha Krishnan', phone: '97410-44556', relationship: 'Spouse' },
    patient: { name: 'V. Krishnan', phone: '97410-44556', age: 62, gender: 'Male', count: 1 },
    typeId: 'cardiac',
    typeLabel: 'Cardiac Emergency',
    typeEmoji: '❤️',
    severity: 'Critical',
    medicalNotes: 'Sudden onset acute chest crushing pain radiating to left arm. Cold sweat and dizziness.',
    symptoms: ['Chest Pain', 'Difficulty Breathing', 'Profuse Sweating'],
    specialAssistance: ['Cardiac defibrillator / monitor', 'Oxygen support required'],
    location: { address: '12th Main, 100ft Road, Indiranagar, Bengaluru', lat: 12.9698, lng: 77.6402 },
    hospital: {
      id: 'hosp-2',
      name: 'Manipal Hospital Indiranagar',
      address: '98 HAL Airport Rd, Kodihalli, Bengaluru',
      distanceKm: 2.1,
      reason: 'Specialized 24/7 cardiac catheterization lab and ICU availability (2.1 km)',
      phone: '080-25024444',
    },
    assignedAmbulance: INITIAL_FLEET[1],
    status: 'AMBULANCE ASSIGNED',
    createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    timeString: new Date(Date.now() - 1000 * 60 * 22).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    history: [
      { status: 'NEW', at: new Date(Date.now() - 1000 * 60 * 22).toISOString() },
      { status: 'ACKNOWLEDGED', at: new Date(Date.now() - 1000 * 60 * 20).toISOString(), note: 'Acknowledged by Control Room Desk' },
      { status: 'AMBULANCE ASSIGNED', at: new Date(Date.now() - 1000 * 60 * 18).toISOString(), note: 'Unit 02 dispatched' },
    ],
    etaMinutes: 6,
  },
  {
    id: 'AF-2026-0126',
    caller: { name: 'Meera Rao', phone: '96320-99887', relationship: 'Daughter' },
    patient: { name: 'Shanta Rao', phone: '96320-99887', age: 71, gender: 'Female', count: 1 },
    typeId: 'breathing',
    typeLabel: 'Breathing Difficulty',
    typeEmoji: '🫁',
    severity: 'High',
    medicalNotes: 'Severe chronic asthma exacerbation. Inhaler exhausted, breathing shallow and labored.',
    symptoms: ['Severe Shortness of Breath', 'Wheezing'],
    specialAssistance: ['High flow oxygen required'],
    location: { address: '4th Block, Jayanagar, Bengaluru', lat: 12.9304, lng: 77.5838 },
    hospital: {
      id: 'hosp-3',
      name: 'Apollo Hospital Jayanagar',
      address: '21/2 14th Cross, 3rd Block, Jayanagar, Bengaluru',
      distanceKm: 1.2,
      reason: 'Nearest tertiary care facility with pulmonary emergency suite (1.2 km)',
      phone: '080-46688888',
    },
    assignedAmbulance: INITIAL_FLEET[2],
    status: 'DISPATCHED',
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    timeString: new Date(Date.now() - 1000 * 60 * 45).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    history: [
      { status: 'NEW', at: new Date(Date.now() - 1000 * 60 * 45).toISOString() },
      { status: 'ACKNOWLEDGED', at: new Date(Date.now() - 1000 * 60 * 43).toISOString() },
      { status: 'AMBULANCE ASSIGNED', at: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
      { status: 'DISPATCHED', at: new Date(Date.now() - 1000 * 60 * 35).toISOString(), note: 'En route to patient' },
    ],
    etaMinutes: 4,
  },
]

// Synthesize pleasant emergency alert chime using standard Web Audio API
export function playAlertChime(): void {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    const now = ctx.currentTime
    // Tone 1: High alert beep (880 Hz - A5)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(880, now)
    gain1.gain.setValueAtTime(0.01, now)
    gain1.gain.exponentialRampToValueAtTime(0.35, now + 0.05)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.3)

    // Tone 2: Harmonized confirmation beep (1174.66 Hz - D6)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'triangle'
    osc2.frequency.setValueAtTime(1174.66, now + 0.16)
    gain2.gain.setValueAtTime(0.01, now + 0.16)
    gain2.gain.exponentialRampToValueAtTime(0.3, now + 0.22)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.16)
    osc2.stop(now + 0.6)
  } catch {
    // Audio context not allowed or unsupported; safe fallback
  }
}

// Distance helper (Haversine km)
export function calculateDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

// Recommend hospital based on coordinates & emergency type
export function findRecommendedHospital(
  lat: number,
  lng: number,
  typeId?: EmergencyTypeId
): HospitalInfo | null {
  const list = hospitalDirectory as Array<{
    id: string
    name: string
    lat: number
    lng: number
    address: string
    district: string
    state: string
    phone?: string
    beds?: number | null
    icuBeds?: number | null
    emergencyServices?: string
    specialties?: string
  }>

  if (!list || list.length === 0) return null

  const candidates = list
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng))
    .map((h) => ({
      ...h,
      distanceKm: calculateDistanceKm(lat, lng, h.lat, h.lng),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)

  if (candidates.length === 0) return null
  const nearest = candidates[0]

  let reason = `Nearest verified medical center (${nearest.distanceKm.toFixed(1)} km straight-line).`
  if (typeId === 'cardiac') {
    reason = `Nearest specialized center with intensive cardiac response (${nearest.distanceKm.toFixed(1)} km).`
  } else if (typeId === 'accident' || typeId === 'trauma') {
    reason = `Nearest emergency trauma capable facility (${nearest.distanceKm.toFixed(1)} km).`
  } else if (typeId === 'burn') {
    reason = `Emergency burns and acute stabilization facility (${nearest.distanceKm.toFixed(1)} km).`
  }

  return {
    id: nearest.id,
    name: nearest.name,
    address: [nearest.address, nearest.district, nearest.state].filter(Boolean).join(', '),
    distanceKm: Number(nearest.distanceKm.toFixed(1)),
    reason,
    phone: nearest.phone || '080-2222-0000',
    beds: nearest.beds ?? null,
    icuBeds: nearest.icuBeds ?? null,
  }
}

// Find recommended ambulance based on location & severity
export function findRecommendedAmbulance(
  fleet: AmbulanceUnit[],
  lat: number,
  lng: number,
  severity: EmergencySeverity
): AmbulanceUnit | null {
  const available = fleet.filter((u) => u.status === 'Available')
  if (available.length === 0) return null

  // If critical, prefer ALS units first
  if (severity === 'Critical') {
    const als = available.filter((u) => u.type.includes('ALS'))
    if (als.length > 0) {
      return als.sort((a, b) => calculateDistanceKm(lat, lng, a.lat, a.lng) - calculateDistanceKm(lat, lng, b.lat, b.lng))[0]
    }
  }

  // Otherwise nearest available
  return available.sort((a, b) => calculateDistanceKm(lat, lng, a.lat, a.lng) - calculateDistanceKm(lat, lng, b.lat, b.lng))[0]
}

// Central emergency management class
class EmergencyStore {
  private channel: BroadcastChannel | null = null
  private listeners: Set<() => void> = new Set()
  private unacknowledgedAlerts: Set<string> = new Set()

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME)
        this.channel.onmessage = (event) => {
          this.handleBroadcastMessage(event.data)
        }
      } catch {
        this.channel = null
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY || e.key === FLEET_STORAGE_KEY) {
          this.notify()
        }
      })
    }
  }

  private handleBroadcastMessage(data: { type: string; emergency?: EmergencyRecord }) {
    if (data.type === 'EMERGENCY_CREATED' && data.emergency) {
      this.unacknowledgedAlerts.add(data.emergency.id)
      playAlertChime()
      this.notify()
    } else if (data.type === 'EMERGENCY_UPDATED' || data.type === 'FLEET_UPDATED') {
      this.notify()
    }
  }

  private notify() {
    this.listeners.forEach((listener) => {
      try {
        listener()
      } catch (err) {
        console.error('Error in emergencyStore listener', err)
      }
    })
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getEmergencies(): EmergencyRecord[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // ignore
    }
    this.saveEmergencies([])
    return []
  }

  public saveEmergencies(records: EmergencyRecord[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
      // Backwards compatibility with existing AidFlow reports table:
      const simplified = records.map((r) => ({
        id: r.id,
        type: r.typeLabel,
        location: r.location.address || `${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)}`,
        time: r.timeString,
        status: r.status === 'NEW' ? 'New' : r.status === 'COMPLETED' ? 'Completed' : 'Processing',
        priority: r.severity,
        reporter: r.caller.name || r.patient.name,
      }))
      localStorage.setItem('aidflow-control-reports', JSON.stringify(simplified))
    } catch {
      // storage quota or private mode
    }
    this.notify()
  }

  public getFleet(): AmbulanceUnit[] {
    try {
      const stored = localStorage.getItem(FLEET_STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // ignore
    }
    this.saveFleet(INITIAL_FLEET)
    return INITIAL_FLEET
  }

  public saveFleet(fleet: AmbulanceUnit[]) {
    try {
      localStorage.setItem(FLEET_STORAGE_KEY, JSON.stringify(fleet))
    } catch {
      // ignore
    }
    this.channel?.postMessage({ type: 'FLEET_UPDATED' })
    this.notify()
  }

  public ingestBackendEmergency(record: EmergencyRecord): void {
    const list = this.getEmergencies()
    const alreadyStored = list.some((item) => item.id === record.id)

    // Always mark a newly received backend event as unacknowledged, even if
    // the initial REST refresh won the race and stored the same case first.
    const isNewAlert = !this.unacknowledgedAlerts.has(record.id)
    this.unacknowledgedAlerts.add(record.id)

    if (alreadyStored) {
      if (isNewAlert) { playAlertChime(); this.notify() }
      return
    }

    playAlertChime()
    this.saveEmergencies([record, ...list])
  }

  public registerEmergency(input: {
    caller: CallerInfo
    patient: PatientInfo
    typeId: EmergencyTypeId
    severity: EmergencySeverity
    medicalNotes: string
    symptoms: string[]
    specialAssistance: string[]
    location: EmergencyLocation
    selectedHospital?: HospitalInfo | null
  }): EmergencyRecord {
    const list = this.getEmergencies()
    const now = new Date()
    const count = list.length + 1
    const id = `AF-2026-${String(128 + count).padStart(4, '0')}`

    const typeMeta = EMERGENCY_TYPES.find((t) => t.id === input.typeId)
    const hospital =
      input.selectedHospital ??
      findRecommendedHospital(input.location.lat, input.location.lng, input.typeId)

    const record: EmergencyRecord = {
      id,
      caller: input.caller,
      patient: input.patient,
      typeId: input.typeId,
      typeLabel: typeMeta?.label || 'Emergency',
      typeEmoji: typeMeta?.emoji || '🚨',
      severity: input.severity,
      medicalNotes: input.medicalNotes,
      symptoms: input.symptoms,
      specialAssistance: input.specialAssistance,
      location: input.location,
      hospital,
      assignedAmbulance: null,
      status: 'NEW',
      createdAt: now.toISOString(),
      timeString: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      history: [
        {
          status: 'NEW',
          at: now.toISOString(),
          note: `Registered in the AidFlow Control Room. Caller: ${input.caller.name || 'Anonymous'} (${input.caller.phone})`,
        },
      ],
    }

    const updated = [record, ...list]
    this.saveEmergencies(updated)
    this.unacknowledgedAlerts.add(id)

    // Broadcast in real-time across tabs
    this.channel?.postMessage({ type: 'EMERGENCY_CREATED', emergency: record })
    playAlertChime()

    return record
  }

  public updateEmergencyStatus(
    id: string,
    status: EmergencyStatus,
    note?: string
  ): EmergencyRecord | null {
    const list = this.getEmergencies()
    let target: EmergencyRecord | null = null
    const now = new Date().toISOString()

    const updated = list.map((item) => {
      if (item.id === id) {
        const history = [...item.history, { status, at: now, note }]
        target = {
          ...item,
          status,
          history,
          ...(status === 'ACKNOWLEDGED' ? { acknowledgedAt: now } : {}),
          ...(status === 'DISPATCHED' ? { dispatchedAt: now } : {}),
          ...(status === 'COMPLETED' ? { completedAt: now } : {}),
        }
        return target
      }
      return item
    })

    if (target) {
      if (status !== 'NEW') {
        this.unacknowledgedAlerts.delete(id)
      }
      this.saveEmergencies(updated)
      this.channel?.postMessage({ type: 'EMERGENCY_UPDATED', emergency: target })
    }
    return target
  }

  public assignAmbulanceToEmergency(
    emergencyId: string,
    ambulanceId: string
  ): EmergencyRecord | null {
    const fleet = this.getFleet()
    const ambulance = fleet.find((a) => a.id === ambulanceId)
    if (!ambulance) return null

    // Update fleet unit status
    const updatedFleet = fleet.map((a) =>
      a.id === ambulanceId ? { ...a, status: 'On assignment' as const } : a
    )
    this.saveFleet(updatedFleet)

    const list = this.getEmergencies()
    let target: EmergencyRecord | null = null
    const now = new Date().toISOString()

    const updatedEmergencies = list.map((item) => {
      if (item.id === emergencyId) {
        const dist = calculateDistanceKm(
          ambulance.lat,
          ambulance.lng,
          item.location.lat,
          item.location.lng
        )
        const eta = Math.max(2, Math.round((dist / 35) * 60))
        target = {
          ...item,
          assignedAmbulance: ambulance,
          status: 'AMBULANCE ASSIGNED' as const,
          etaMinutes: eta,
          history: [
            ...item.history,
            {
              status: 'AMBULANCE ASSIGNED' as const,
              at: now,
              note: `Assigned ${ambulance.label} (Driver: ${ambulance.driver}, Contact: ${ambulance.driverPhone}). Est ETA: ~${eta} min`,
            },
          ],
        }
        return target
      }
      return item
    })

    if (target) {
      this.saveEmergencies(updatedEmergencies)
      this.channel?.postMessage({ type: 'EMERGENCY_UPDATED', emergency: target })
    }
    return target
  }

  public setSimulatedMovement(emergencyId: string, active: boolean, progress = 0): void {
    const list = this.getEmergencies()
    const updated = list.map((item) => {
      if (item.id === emergencyId) {
        return {
          ...item,
          isSimulatedMovementActive: active,
          simulatedProgress: progress,
        }
      }
      return item
    })
    this.saveEmergencies(updated)
  }

  public acknowledgeAlert(id: string): void {
    this.unacknowledgedAlerts.delete(id)
    this.notify()
  }

  public getUnacknowledgedIds(): string[] {
    return Array.from(this.unacknowledgedAlerts)
  }

  public clearUnacknowledged(): void {
    this.unacknowledgedAlerts.clear()
    this.notify()
  }

  public resetDemoData(): void {
    this.saveEmergencies(INITIAL_EMERGENCIES)
    this.saveFleet(INITIAL_FLEET)
    this.unacknowledgedAlerts.clear()
    this.notify()
  }
}

export const emergencyStore = new EmergencyStore()
