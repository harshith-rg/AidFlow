import type {
  EmergencyCase,
  EmergencyTypeId,
  Severity,
  CaseStatus,
  AssignedAmbulance,
  Hospital,
  StatusEvent,
} from '../../types/contract'

export function toEmergencyCase(
  row: any,
  historyRows: any[] = [],
  ambulanceRow?: any,
  hospitalRow?: any
): EmergencyCase {
  let ambulance: AssignedAmbulance | undefined
  if (ambulanceRow || row.assigned_ambulance_id) {
    const amb = ambulanceRow || row
    if (amb.amb_label || amb.label) {
      const driverFullName = amb.driver_name || amb.driver_full_name || ''
      const driverFirstName = driverFullName.trim().split(/\s+/)[0] || 'Driver'

      ambulance = {
        id: amb.amb_id || amb.ambulance_id || row.assigned_ambulance_id,
        label: amb.amb_label || amb.label,
        vehicleNumber: amb.amb_vehicle_number || amb.vehicle_number || '',
        driverFirstName,
        isTest: amb.amb_is_test !== undefined ? amb.amb_is_test : amb.is_test ?? false,
        lat: amb.amb_lat !== undefined && amb.amb_lat !== null ? Number(amb.amb_lat) : undefined,
        lng: amb.amb_lng !== undefined && amb.amb_lng !== null ? Number(amb.amb_lng) : undefined,
        lastLocationAt: amb.amb_last_location_at ? new Date(amb.amb_last_location_at).toISOString() : undefined,
      }
    }
  }

  let hospital: Hospital | undefined
  if (hospitalRow || row.hosp_name) {
    const h = hospitalRow || row
    hospital = {
      id: h.hosp_id || h.id || row.hospital_id,
      name: h.hosp_name || h.name,
      lat: Number(h.hosp_lat !== undefined ? h.hosp_lat : h.lat),
      lng: Number(h.hosp_lng !== undefined ? h.hosp_lng : h.lng),
      address: h.hosp_address || h.address || undefined,
      phone: h.hosp_phone || h.phone || undefined,
      category: h.hosp_category || h.category || undefined,
      capacityStatus: (h.hosp_capacity_status || h.capacity_status || 'unknown') as any,
      beds: h.hosp_beds !== undefined ? h.hosp_beds : h.beds,
      icuBeds: h.hosp_icu_beds !== undefined ? h.hosp_icu_beds : h.icu_beds,
      lastUpdated: h.hosp_last_updated ? new Date(h.hosp_last_updated).toISOString() : undefined,
    }
  }

  const history: StatusEvent[] = historyRows.map((h) => ({
    status: h.to_status as CaseStatus,
    at: new Date(h.changed_at).toISOString(),
  }))

  return {
    id: row.case_code,
    type: row.type as EmergencyTypeId,
    severity: row.severity as Severity,
    reporterName: row.reporter_name,
    reporterPhone: row.reporter_phone,
    description: row.description || undefined,
    pickup: {
      lat: Number(row.pickup_lat),
      lng: Number(row.pickup_lng),
      address: row.pickup_address || undefined,
    },
    status: row.status as CaseStatus,
    ambulance,
    hospital,
    hospitalReason: row.hospital_reason || undefined,
    etaMinutes: row.eta_minutes !== null ? Number(row.eta_minutes) : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    history,
    cancelReason: row.cancel_reason || undefined,
    isDemo: Boolean(row.is_demo),
    source: row.source || undefined,
    callSessionId: row.call_session_id || undefined,
  }
}
