import {
  EMERGENCY_TYPES,
  type CaseStatus,
  type EmergencyCase,
  type Severity,
} from '../types/contract'
import type {
  EmergencyRecord,
  EmergencyStatus,
  EmergencySeverity,
  AmbulanceUnit,
  HospitalInfo,
} from './emergencyStore'

export function contractStatusToUiStatus(status: CaseStatus): EmergencyStatus {
  switch (status) {
    case 'waiting':
      return 'NEW'
    case 'offered':
      return 'ACKNOWLEDGED'
    case 'assigned':
      return 'AMBULANCE ASSIGNED'
    case 'en_route':
      return 'DISPATCHED'
    case 'reached_patient':
    case 'heading_to_hospital':
    case 'handed_over':
      return 'PATIENT PICKED UP'
    case 'completed':
      return 'COMPLETED'
    case 'cancelled':
      return 'CANCELLED'
    default:
      return 'NEW'
  }
}

export function uiStatusToContractStatus(status: EmergencyStatus): CaseStatus {
  switch (status) {
    case 'NEW':
      return 'waiting'
    case 'ACKNOWLEDGED':
      return 'offered'
    case 'AMBULANCE ASSIGNED':
      return 'assigned'
    case 'DISPATCHED':
      return 'en_route'
    case 'PATIENT PICKED UP':
      return 'reached_patient'
    case 'COMPLETED':
      return 'completed'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'waiting'
  }
}

export function contractSeverityToUi(severity: Severity): EmergencySeverity {
  switch (severity) {
    case 'critical':
      return 'Critical'
    case 'high':
      return 'High'
    case 'medium':
      return 'Moderate'
    default:
      return 'Moderate'
  }
}

export function uiSeverityToContract(severity: EmergencySeverity): Severity {
  switch (severity) {
    case 'Critical':
      return 'critical'
    case 'High':
      return 'high'
    case 'Moderate':
      return 'medium'
    default:
      return 'medium'
  }
}

export function emergencyCaseToRecord(c: EmergencyCase): EmergencyRecord {
  const typeMeta = EMERGENCY_TYPES.find((t) => t.id === c.type)
  const uiStatus = contractStatusToUiStatus(c.status)
  const uiSeverity = contractSeverityToUi(c.severity)

  const assignedAmbulance: AmbulanceUnit | null = c.ambulance
    ? {
        id: c.ambulance.id,
        label: c.ambulance.label,
        vehicleNumber: c.ambulance.vehicleNumber,
        driver: c.ambulance.driverFirstName,
        driverPhone: 'Simulated Driver Line',
        type: 'Advanced Life Support (ALS)',
        status: 'On assignment',
        lat: c.pickup.lat + 0.005,
        lng: c.pickup.lng + 0.005,
        zone: 'Assigned Operational Zone',
      }
    : null

  const hospital: HospitalInfo | null = c.hospital
    ? {
        id: c.hospital.id,
        name: c.hospital.name,
        address: c.hospital.address || 'Bangalore, Karnataka',
        distanceKm: 0,
        reason: c.hospitalReason || 'Nearest specialized facility',
        phone: c.hospital.phone,
        beds: c.hospital.beds ?? null,
        icuBeds: c.hospital.icuBeds ?? null,
      }
    : null

  return {
    id: c.id,
    caller: {
      name: c.reporterName,
      phone: c.reporterPhone,
      relationship: 'Emergency Reporter',
      simulatedLocation: c.pickup.address,
    },
    patient: {
      name: c.reporterName,
      phone: c.reporterPhone,
      count: 1,
    },
    typeId: c.type,
    typeLabel: typeMeta ? typeMeta.label : c.type,
    typeEmoji: typeMeta ? typeMeta.emoji : '🚨',
    severity: uiSeverity,
    medicalNotes: c.description || '',
    symptoms: [],
    specialAssistance: [],
    location: {
      address: c.pickup.address || `Coordinates (${c.pickup.lat.toFixed(4)}, ${c.pickup.lng.toFixed(4)})`,
      lat: c.pickup.lat,
      lng: c.pickup.lng,
    },
    hospital,
    assignedAmbulance,
    status: uiStatus,
    createdAt: c.createdAt,
    timeString: new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    history: (c.history || []).map((h) => ({
      status: contractStatusToUiStatus(h.status),
      at: h.at,
      note: h.status,
    })),
    etaMinutes: c.etaMinutes || 5,
    isSimulatedMovementActive: false,
    simulatedProgress: 0,
  }
}
