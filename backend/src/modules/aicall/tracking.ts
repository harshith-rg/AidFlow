import { createHash } from 'node:crypto'

export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface TrackingRow {
  case_code: string
  status: string
  eta_minutes: number | null
  pickup_address: string | null
  reporter_name?: string | null
  reporter_phone?: string | null
  ambulance_label: string | null
  vehicle_number: string | null
  driver_name: string | null
  hospital_name: string | null
  pickup_lat?: number | null
  pickup_lng?: number | null
  hospital_lat?: number | null
  hospital_lng?: number | null
  ambulance_lat?: number | null
  ambulance_lng?: number | null
  history: Array<{ status: string; at: string }>
}

/** Explicit allow-list: never pass the DB row through to an unauthenticated caller. */
export function publicTrackingProjection(row: TrackingRow) {
  return {
    caseCode: row.case_code,
    status: row.status,
    etaMinutes: row.eta_minutes ?? undefined,
    ambulance: row.ambulance_label ? {
      label: row.ambulance_label,
      vehicleNumber: row.vehicle_number,
      driverFirstName: String(row.driver_name ?? '').split(' ')[0],
    } : undefined,
    hospitalName: row.hospital_name ?? undefined,
    pickup: row.pickup_address ?? undefined,
    reporterName: row.reporter_name ?? undefined,
    reporterPhone: row.reporter_phone ?? undefined,
    pickupLocation: row.pickup_lat != null && row.pickup_lng != null ? { lat: row.pickup_lat, lng: row.pickup_lng } : undefined,
    hospitalLocation: row.hospital_lat != null && row.hospital_lng != null ? { lat: row.hospital_lat, lng: row.hospital_lng } : undefined,
    ambulanceLocation: row.ambulance_lat != null && row.ambulance_lng != null ? { lat: row.ambulance_lat, lng: row.ambulance_lng } : undefined,
    history: row.history ?? [],
  }
}
