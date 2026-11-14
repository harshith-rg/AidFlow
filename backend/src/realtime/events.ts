import type { Server } from 'socket.io'
import type { CaseStatus, EmergencyCase, LatLng, Role } from '../types/contract'
import { logger } from '../utils/logger'

export interface EventPayloads {
  'dispatch:offered': {
    attemptId: string
    caseId: string
    ambulanceId: string
    expiresAt: string
    pickup: LatLng
    emergencyType: string
    severity: string
    etaMinutes: number
  }
  'dispatch:accepted': {
    attemptId: string
    caseId: string
    ambulanceId: string
    driverId?: string
  }
  'dispatch:rejected': {
    attemptId: string
    caseId: string
    ambulanceId: string
    reason?: string
  }
  'dispatch:timeout': {
    attemptId: string
    caseId: string
    ambulanceId: string
  }
  'dispatch:reassigned': {
    caseId: string
    newAmbulanceId: string
  }
  'case:created': {
    caseId: string
    emergency: EmergencyCase
  }
  'case:status': {
    caseId: string
    status: CaseStatus
    changedBy?: string | null
    note?: string
    timestamp: string
  }
  'alert:new': {
    id: string
    type: 'dispatch' | 'hospital' | 'system' | 'no_ambulance' | 'emergency_reported'
    message: string
    emergencyId?: string | null
    targetRole?: Role | null
    hospitalId?: string | null
    createdAt: string
  }
  'ambulance:location': {
    ambulanceId: string
    lat: number
    lng: number
    heading?: number | null
    speedKmh?: number | null
    timestamp: string
    isStale: boolean
    simulated: boolean
  }
  'call:incoming': {
    callSessionId: string
    direction: 'inbound_caller' | 'outbound_driver'
    fromNumber: string
    toNumber: string
    callerName?: string | null
    emergencyId?: string | null
    ambulanceId?: string | null
    simulated: boolean
    prompt?: string
  }
  'call:transcript': { callSessionId: string; speaker: 'caller' | 'ai'; text: string; slots?: Record<string, unknown> }
  'call:updated': {
    callSessionId: string
    status: 'ringing' | 'in_progress' | 'completed' | 'missed' | 'failed'
    answeredBy?: string | null
    dtmfInput?: string | null
  }
  'call:ended': {
    callSessionId: string
    status: 'completed' | 'missed' | 'failed'
    endReason?: string | null
  }
  'hospital:incoming': {
    hospitalId: string
    caseId: string
    ambulanceId: string
    etaMinutes: number
    emergencyType: string
    severity: string
  }
}

let ioInstance: Server | null = null

export function setIoInstance(io: Server) {
  ioInstance = io
}

export function getIoInstance(): Server | null {
  return ioInstance
}

export function emitToRoom<K extends keyof EventPayloads>(
  room: string,
  event: K,
  payload: EventPayloads[K]
): void {
  if (!ioInstance) {
    logger.debug({ room, event, payload }, 'Socket.IO not initialized; event skipped in test/cli mode')
    return
  }
  ioInstance.to(room).emit(event, payload)
}

export function emitToAll<K extends keyof EventPayloads>(
  event: K,
  payload: EventPayloads[K]
): void {
  if (!ioInstance) {
    logger.debug({ event, payload }, 'Socket.IO not initialized; broadcast skipped')
    return
  }
  ioInstance.emit(event, payload)
}
