// The central API client for AidFlow frontend.
// Supports both real backend (Socket.IO + REST) and offline mock fallback.
import type {
  AlertItem,
  Ambulance,
  CaseStatus,
  CreateEmergencyInput,
  EmergencyCase,
  EmergencyTypeId,
  Hospital,
  LatLng,
  Role,
  Severity,
} from '../types/contract'
import { ApiException } from './errors'
import { mockApi } from './mock'
import { joinCaseRoom, leaveCaseRoom, onSocketEvent } from '../realtime/socket'

export interface UserProfile {
  id: string
  email: string
  role: Role
  name: string
  hospitalId?: string | null
}

export interface AuthResponse {
  token: string
  user: UserProfile
}

export interface DispatchOfferDetails {
  attemptId: string
  attemptNo: number
  emergencyId: string
  caseCode: string
  ambulanceId: string
  driverId: string | null
  expiresAt: string
  pickup: LatLng
  emergencyType: string
  severity: string
  etaMinutes: number
}

export interface DriverRequestsResponse {
  pendingOffer: DispatchOfferDetails | null
  activeCase: EmergencyCase | null
}

export interface TelephonyConfig {
  helplineNumber: string
  simulated: boolean
  notice: string
}

export interface CallSession {
  id: string
  direction: 'inbound_caller' | 'outbound_driver'
  from_number: string
  to_number: string
  caller_name: string | null
  status: 'ringing' | 'in_progress' | 'completed' | 'missed' | 'failed'
  emergency_id: string | null
  ambulance_id: string | null
  dispatch_attempt_id: string | null
  answered_by: string | null
  dtmf_input: string | null
  simulated: boolean
  started_at: string
  answered_at?: string | null
  ended_at?: string | null
  end_reason?: string | null
}


export interface AICallSlots { type?: EmergencyTypeId; description?: string; patientCount?: number; conscious?: boolean; breathing?: boolean; lat?: number; lng?: number; locationText?: string; callerName?: string; callerPhone?: string; specialContext?: string }
export interface AICallStart { sessionId: string; greeting: string; language: string }
export interface AICallTurn { agentReply: string; slots: AICallSlots; missingSlots: string[]; done: boolean }
export interface AICallFinalize { caseCode: string; trackingToken: string; etaMinutes?: number; severity: Severity; agentClosingMessage: string }
export interface RouteEstimate {
  distanceKm: number
  durationMin: number
  geometry: LatLng[]
  source: string
  assumptions: string
}
export interface PublicTracking { caseCode: string; status: string; reporterName?: string; reporterPhone?: string; etaMinutes?: number; ambulance?: { label: string; vehicleNumber: string; driverFirstName: string }; hospitalName?: string; pickup?: string; pickupLocation?: {lat:number;lng:number}; hospitalLocation?: {lat:number;lng:number}; ambulanceLocation?: {lat:number;lng:number}; history: Array<{status:string;at:string}> }

export interface Api {
  startAICall(input: { callerName?: string; callerNumber?: string; lat?: number; lng?: number; language?: string }): Promise<AICallStart>
  sendAICallTurn(id: string, transcript: string, location?: {lat:number;lng:number}): Promise<AICallTurn>
  finalizeAICall(id: string, allowPartial?: boolean): Promise<AICallFinalize>
  abandonAICall(id: string): Promise<void>
  getPublicTracking(token: string): Promise<PublicTracking>
  getAmbulanceRoute(from: LatLng, to: LatLng): Promise<RouteEstimate>
  // Auth
  login(email: string, password: string): Promise<AuthResponse>
  register(email: string, password: string, name: string, phone?: string): Promise<AuthResponse>
  me(): Promise<{ user: UserProfile }>

  // Cases
  createEmergency(
    input: CreateEmergencyInput & {
      source?: 'web' | 'call' | 'manual'
      severity?: Severity
      callSessionId?: string | null
    }
  ): Promise<EmergencyCase>
  getCase(id: string): Promise<EmergencyCase>
  listCases(filters?: { status?: CaseStatus; type?: EmergencyTypeId; limit?: number }): Promise<EmergencyCase[]>
  listControlRoomCases(): Promise<EmergencyCase[]>
  getControlRoomCase(id: string): Promise<EmergencyCase>
  cancelCase(id: string, reason: string): Promise<EmergencyCase>
  completeCase(id: string): Promise<EmergencyCase>
  assignCase(id: string, ambulanceId: string): Promise<EmergencyCase>

  // Driver
  getDriverRequests(): Promise<DriverRequestsResponse>
  updateDriverJourney(caseId: string, status: CaseStatus): Promise<{ case: EmergencyCase }>
  acceptDispatch(attemptId: string): Promise<EmergencyCase>
  rejectDispatch(attemptId: string, reason?: string): Promise<{ ok: boolean }>

  // Ambulances & Location
  listAmbulances(): Promise<Ambulance[]>
  updateAmbulanceAvailability(id: string, status: 'available' | 'offline'): Promise<{ id: string; status: string }>
  updateAmbulanceLocation(payload: {
    ambulanceId: string
    lat: number
    lng: number
    timestamp?: string
    heading?: number
    speed?: number
  }): Promise<{ applied: boolean; reason?: string }>

  // Hospitals
  listHospitals(): Promise<Hospital[]>
  getHospitalStatus(id: string): Promise<Hospital>
  updateHospitalStatus(
    id: string,
    payload: {
      capacity_status?: 'available' | 'limited' | 'full' | 'unknown'
      beds?: number
      icu_beds?: number
      is_operational?: boolean
    }
  ): Promise<Hospital>
  getHospitalIncoming(id: string): Promise<{ cases: EmergencyCase[] }>

  // Alerts
  listAlerts(): Promise<AlertItem[]>
  acknowledgeAlert(id: string): Promise<AlertItem>

  // Telephony
  getTelephonyConfig(): Promise<TelephonyConfig>
  createIncomingCall(payload: {
    callerNumber: string
    callerName?: string
    lat?: number
    lng?: number
  }): Promise<CallSession>
  answerCall(id: string): Promise<CallSession>
  registerEmergencyFromCall(id: string, payload: CreateEmergencyInput): Promise<EmergencyCase>
  endCall(id: string, reason?: string): Promise<CallSession>
  sendDtmf(id: string, digit: string): Promise<{ action: string; message: string; case?: EmergencyCase }>
  listCalls(): Promise<CallSession[]>

  // Subscription
  subscribeCase(
    id: string,
    onChange: (c: EmergencyCase) => void,
    onError?: (e: Error) => void
  ): () => void
}

export const isMock = import.meta.env.VITE_API_MODE === 'mock'
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem('aidflow_token')
  } catch {
    return null
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem('aidflow_token', token)
    } else {
      localStorage.removeItem('aidflow_token')
    }
  } catch {
    /* storage unavailable */
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers,
    })
  } catch {
    throw new ApiException('NETWORK', 'Could not reach the server. Please check that the backend is running.')
  }

  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    const err = body?.error
    if (res.status === 401) {
      // Clear token on 401 Unauthorized
      setStoredToken(null)
    }
    throw new ApiException(
      err?.code ?? 'SERVER',
      `${err?.message ?? `Request failed with status ${res.status}.`}${err?.requestId ? ` (Reference: ${err.requestId})` : ''}`
    )
  }

  return body as T
}

const realApi: Api = {
  startAICall: (input) => request<AICallStart>('/ai-calls/start', { method: 'POST', body: JSON.stringify(input) }),
  sendAICallTurn: (id, transcript, location) => request<AICallTurn>(`/ai-calls/${encodeURIComponent(id)}/turn`, { method: 'POST', body: JSON.stringify({ transcript, ...location }) }),
  finalizeAICall: (id, allowPartial = false) => request<AICallFinalize>(`/ai-calls/${encodeURIComponent(id)}/finalize`, { method: 'POST', body: JSON.stringify({ allowPartial }) }),
  abandonAICall: (id) => request<void>(`/ai-calls/${encodeURIComponent(id)}/abandon`, { method: 'POST' }),
  getPublicTracking: (token) => request<PublicTracking>(`/track/${encodeURIComponent(token)}`),
  getAmbulanceRoute: (from, to) => request<RouteEstimate>('/routing/route', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  }),
  // Auth
  login: (email, password) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email, password, name, phone) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, phone }),
    }),
  me: () => request<{ user: UserProfile }>('/auth/me'),

  // Cases
  createEmergency: (input) =>
    request<EmergencyCase>('/emergencies', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getCase: (id) => request<EmergencyCase>(`/emergencies/${encodeURIComponent(id)}`),
  listControlRoomCases: () => request<EmergencyCase[]>('/control-room/cases'),
  getControlRoomCase: (id) => request<EmergencyCase>(`/control-room/cases/${encodeURIComponent(id)}`),
  listCases: (filters) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.type) params.set('type', filters.type)
    if (filters?.limit) params.set('limit', String(filters.limit))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return request<EmergencyCase[]>(`/emergencies${qs}`)
  },
  cancelCase: (id, reason) =>
    request<EmergencyCase>(`/emergencies/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  completeCase: (id) =>
    request<EmergencyCase>(`/emergencies/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
    }),
  assignCase: (id, ambulanceId) =>
    request<EmergencyCase>(`/emergencies/${encodeURIComponent(id)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ ambulanceId }),
    }),

  // Driver
  getDriverRequests: () => request<DriverRequestsResponse>('/driver/requests'),
  updateDriverJourney: (caseId, status) =>
    request<{ case: EmergencyCase }>(`/driver/cases/${encodeURIComponent(caseId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  acceptDispatch: (attemptId) =>
    request<EmergencyCase>(`/dispatch/${encodeURIComponent(attemptId)}/accept`, {
      method: 'POST',
    }),
  rejectDispatch: (attemptId, reason) =>
    request<{ ok: boolean }>(`/dispatch/${encodeURIComponent(attemptId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Ambulances & Location
  listAmbulances: () => request<Ambulance[]>('/ambulances'),
  updateAmbulanceAvailability: (id, status) =>
    request<{ id: string; status: string }>(`/ambulances/${encodeURIComponent(id)}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  updateAmbulanceLocation: (payload) =>
    request<{ applied: boolean; reason?: string }>(
      `/ambulances/${encodeURIComponent(payload.ambulanceId)}/location`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  // Hospitals
  listHospitals: () => request<Hospital[]>('/hospitals'),
  getHospitalStatus: (id) => request<Hospital>(`/hospitals/${encodeURIComponent(id)}/status`),
  updateHospitalStatus: (id, payload) =>
    request<Hospital>(`/hospitals/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getHospitalIncoming: (id) =>
    request<{ cases: EmergencyCase[] }>(`/hospitals/${encodeURIComponent(id)}/incoming`),

  // Alerts
  listAlerts: () => request<AlertItem[]>('/alerts'),
  acknowledgeAlert: (id) =>
    request<AlertItem>(`/alerts/${encodeURIComponent(id)}/acknowledge`, {
      method: 'PATCH',
    }),

  // Telephony
  getTelephonyConfig: () => request<TelephonyConfig>('/telephony/config'),
  createIncomingCall: (payload) =>
    request<CallSession>('/calls/incoming', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  answerCall: (id) =>
    request<CallSession>(`/calls/${encodeURIComponent(id)}/answer`, {
      method: 'POST',
    }),
  registerEmergencyFromCall: (id, payload) =>
    request<EmergencyCase>(`/calls/${encodeURIComponent(id)}/register-emergency`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  endCall: (id, reason) =>
    request<CallSession>(`/calls/${encodeURIComponent(id)}/end`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  sendDtmf: (id, digit) =>
    request<{ action: string; message: string; case?: EmergencyCase }>(
      `/calls/${encodeURIComponent(id)}/dtmf`,
      {
        method: 'POST',
        body: JSON.stringify({ digit }),
      }
    ),
  listCalls: () => request<CallSession[]>('/calls'),

  // Real-time Socket.IO subscription with fallback polling
  subscribeCase(id, onChange, onError) {
    let stopped = false

    // Join room on Socket.IO
    joinCaseRoom(id)

    // Listen to real-time events
    const unsubStatus = onSocketEvent('case:status', (event) => {
      if (event.caseId === id && !stopped) {
        realApi.getCase(id).then(onChange).catch((e) => onError?.(e))
      }
    })

    const unsubAccept = onSocketEvent('dispatch:accepted', (event) => {
      if (event.caseId === id && !stopped) {
        realApi.getCase(id).then(onChange).catch((e) => onError?.(e))
      }
    })

    // Initial fetch
    realApi.getCase(id).then(onChange).catch((e) => onError?.(e))

    // Fallback heartbeat polling every 3 seconds
    const timer = setInterval(async () => {
      if (stopped) return
      try {
        const c = await realApi.getCase(id)
        if (!stopped) onChange(c)
      } catch (err) {
        if (!stopped) onError?.(err as Error)
      }
    }, 3000)

    return () => {
      stopped = true
      clearInterval(timer)
      unsubStatus()
      unsubAccept()
      leaveCaseRoom(id)
    }
  },
}

export const api: Api = isMock ? mockApi : realApi
export { ApiException } from './errors'
