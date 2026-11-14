import type { PoolClient } from 'pg'
import { pool } from '../../db/pool'
import { env } from '../../config/env'
import { getRoutingProvider } from './router'
import type { LatLng } from './types'
import type { EmergencyTypeId, Severity } from '../../types/contract'
import { badRequest } from '../../utils/errors'

export interface HospitalCandidate {
  id: string
  name: string
  address?: string | null
  phone?: string | null
  category?: string | null
  lat: number
  lng: number
  is_operational: boolean
  capacity_status: 'available' | 'limited' | 'full' | 'unknown'
  beds?: number | null
  icu_beds?: number | null
  specialties: string[]
  last_updated?: string | Date | null
  is_demo?: boolean
}

export interface RecommendationInput {
  pickup: LatLng
  emergencyType: EmergencyTypeId
  severity: Severity
  candidates?: HospitalCandidate[]
  client?: PoolClient
}

export interface ScoredHospital {
  hospital: HospitalCandidate
  score: number
  distanceKm: number
  etaMinutes: number
  etaSource: string
  geometry: LatLng[]
  factors: string[]
}

export interface RecommendationOutput {
  recommended: ScoredHospital | null
  alternatives: ScoredHospital[]
  reason: string
  distanceKm: number
  etaMinutes: number
  etaSource: string
  geometry: LatLng[]
  filteredOut: { hospitalId: string; name: string; why: string }[]
}

const SPECIALTY_REQUIREMENTS: Record<EmergencyTypeId, string[]> = {
  cardiac: ['cardiology'],
  stroke: ['neurology'],
  burn: ['burns'],
  trauma: ['trauma', 'orthopaedics'],
  accident: ['trauma', 'orthopaedics'],
  fracture: ['orthopaedics', 'trauma'],
  breathing: ['pulmonology'],
  poisoning: ['toxicology', 'emergency', 'general'],
  other: ['general'],
  fire: ['burns', 'trauma'],
}

/**
 * Recommends the optimal hospital for an emergency case based on specialty match,
 * capacity, ICU availability, real/estimated travel time, and penalty scoring.
 */
export async function recommendHospital(input: RecommendationInput): Promise<RecommendationOutput> {
  const { pickup, emergencyType, severity } = input

  if (
    typeof pickup?.lat !== 'number' ||
    typeof pickup?.lng !== 'number' ||
    pickup.lat < -90 ||
    pickup.lat > 90 ||
    pickup.lng < -180 ||
    pickup.lng > 180
  ) {
    throw badRequest('Valid pickup coordinates are required for hospital recommendation.')
  }

  // Fetch candidates from DB if not provided
  let candidates = input.candidates
  if (!candidates) {
    const db = input.client || pool
    const res = await db.query(
      `SELECT id, name, address, phone, category, lat, lng,
              is_operational, capacity_status, beds, icu_beds,
              specialties, last_updated, is_demo
       FROM hospitals
       WHERE lat BETWEEN $1 - 0.75 AND $1 + 0.75
         AND lng BETWEEN $2 - 0.90 AND $2 + 0.90
       ORDER BY ((lat - $1) * (lat - $1) + (lng - $2) * (lng - $2))
       LIMIT 60`,
      [pickup.lat, pickup.lng]
    )
    candidates = res.rows.map((r) => ({
      ...r,
      lat: Number(r.lat),
      lng: Number(r.lng),
      beds: r.beds !== null ? Number(r.beds) : null,
      icu_beds: r.icu_beds !== null ? Number(r.icu_beds) : null,
      specialties: r.specialties || [],
    }))
  }

  const requiredSpecs = SPECIALTY_REQUIREMENTS[emergencyType] || ['general']
  const staleCutoff = Date.now() - (env.HOSPITAL_STALE_HOURS || 24) * 60 * 60 * 1000

  const filteredOut: { hospitalId: string; name: string; why: string }[] = []
  const eligible: { candidate: HospitalCandidate; hasPrimarySpecialty: boolean; isStale: boolean }[] = []

  for (const c of candidates) {
    if (!c.is_operational) {
      filteredOut.push({ hospitalId: c.id, name: c.name, why: 'Hospital is currently not operational' })
      continue
    }

    if (c.capacity_status === 'full') {
      filteredOut.push({ hospitalId: c.id, name: c.name, why: 'Hospital capacity is full' })
      continue
    }

    if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || isNaN(c.lat) || isNaN(c.lng)) {
      filteredOut.push({ hospitalId: c.id, name: c.name, why: 'Invalid hospital coordinates' })
      continue
    }

    const hospSpecs = (c.specialties || []).map((s) => s.toLowerCase())
    const hasPrimary = requiredSpecs.some((s) => hospSpecs.includes(s.toLowerCase()))
    const hasGeneralFallback = hospSpecs.includes('general')

    if (!hasPrimary && !hasGeneralFallback) {
      filteredOut.push({
        hospitalId: c.id,
        name: c.name,
        why: `Missing required specialty (${requiredSpecs.join('/')}) and no general fallback`,
      })
      continue
    }

    const lastUpdatedMs = c.last_updated ? new Date(c.last_updated).getTime() : 0
    const isStale = lastUpdatedMs > 0 && lastUpdatedMs < staleCutoff

    eligible.push({ candidate: c, hasPrimarySpecialty: hasPrimary, isStale })
  }

  if (eligible.length === 0) {
    return {
      recommended: null,
      alternatives: [],
      reason: 'No suitable hospital found matching specialty or capacity requirements in the operational area.',
      distanceKm: 0,
      etaMinutes: 0,
      etaSource: 'none',
      geometry: [],
      filteredOut,
    }
  }

  const routingProvider = getRoutingProvider()
  const scoredList: ScoredHospital[] = []

  for (const item of eligible) {
    const { candidate, hasPrimarySpecialty, isStale } = item
    const route = await routingProvider.route(pickup, { lat: candidate.lat, lng: candidate.lng })

    let penalty = 0
    const factors: string[] = []

    if (candidate.capacity_status === 'limited') {
      penalty += 5
      factors.push('limited bed capacity (+5)')
    } else if (candidate.capacity_status === 'unknown') {
      penalty += 8
      factors.push('unconfirmed bed capacity (+8)')
    } else {
      factors.push('bed capacity available')
    }

    if (isStale) {
      penalty += 5
      factors.push('stale capacity telemetry (+5)')
    }

    if (severity === 'critical' && (!candidate.icu_beds || candidate.icu_beds === 0)) {
      penalty += 10
      factors.push('critical case with 0 ICU beds (+10)')
    } else if (candidate.icu_beds && candidate.icu_beds > 0) {
      factors.push(`${candidate.icu_beds} ICU beds`)
    }

    if (!hasPrimarySpecialty) {
      penalty += 6
      factors.push(`general facility fallback for ${emergencyType} (+6)`)
    } else {
      factors.push(`specialized in ${requiredSpecs.join('/')}`)
    }

    const score = route.durationMin + penalty

    scoredList.push({
      hospital: candidate,
      score,
      distanceKm: route.distanceKm,
      etaMinutes: route.durationMin,
      etaSource: route.source,
      geometry: route.geometry,
      factors,
    })
  }

  // Sort: lower score wins; tie-break: lower distanceKm, then hospital name
  scoredList.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
    return a.hospital.name.localeCompare(b.hospital.name)
  })

  const top = scoredList[0]
  const alternatives = scoredList.slice(1, 4)

  const reason = `Recommended ${top.hospital.name}: ${top.distanceKm} km away, ~${top.etaMinutes} min estimated transit (${top.etaSource}), ${top.factors.join(', ')}.`

  return {
    recommended: top,
    alternatives,
    reason,
    distanceKm: top.distanceKm,
    etaMinutes: top.etaMinutes,
    etaSource: top.etaSource,
    geometry: top.geometry,
    filteredOut,
  }
}
