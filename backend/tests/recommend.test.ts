import { describe, it, expect, vi } from 'vitest'
import {
  recommendHospital,
  mapWithBoundedConcurrency,
  ROUTING_CONCURRENCY_LIMIT,
  type HospitalCandidate,
} from '../src/modules/routing/recommend'
import type { RoutingProvider } from '../src/modules/routing/types'

describe('Hospital Recommendation & Bounded Concurrency', () => {
  const baseCandidate: HospitalCandidate = {
    id: 'hosp-1',
    name: 'Apollo Hospital Bannerghatta',
    lat: 12.89,
    lng: 77.6,
    is_operational: true,
    capacity_status: 'available',
    beds: 25,
    icu_beds: 5,
    specialties: ['cardiology', 'trauma'],
    last_updated: new Date().toISOString(),
  }

  describe('mapWithBoundedConcurrency', () => {
    it('limits active concurrent tasks to the specified bound', async () => {
      let activeCount = 0
      let maxActive = 0
      const items = Array.from({ length: 12 }, (_, i) => i)

      const results = await mapWithBoundedConcurrency(items, 3, async (item) => {
        activeCount++
        if (activeCount > maxActive) maxActive = activeCount
        await new Promise((r) => setTimeout(r, 15))
        activeCount--
        return item * 10
      })

      expect(maxActive).toBeLessThanOrEqual(3)
      expect(results).toEqual(items.map((i) => i * 10))
    })

    it('returns empty array when given empty input', async () => {
      const res = await mapWithBoundedConcurrency([], 5, async (x) => x)
      expect(res).toEqual([])
    })

    it('defaults ROUTING_CONCURRENCY_LIMIT to 5', () => {
      expect(ROUTING_CONCURRENCY_LIMIT).toBe(5)
    })
  })

  describe('recommendHospital with in-memory candidates', () => {
    it('ranks deterministically based on specialty match, capacity and travel time', async () => {
      const candA: HospitalCandidate = {
        ...baseCandidate,
        id: 'hosp-cardio',
        name: 'Heart Specialized Institute',
        specialties: ['cardiology'],
        beds: 30,
        icu_beds: 4,
        lat: 12.93,
        lng: 77.62,
      }

      const candB: HospitalCandidate = {
        ...baseCandidate,
        id: 'hosp-gen',
        name: 'General Community Clinic',
        specialties: ['general'],
        beds: 10,
        icu_beds: 0,
        lat: 12.91,
        lng: 77.61,
      }

      const res = await recommendHospital({
        pickup: { lat: 12.92, lng: 77.61 },
        emergencyType: 'cardiac',
        severity: 'critical',
        candidates: [candA, candB],
      })

      expect(res.recommended).not.toBeNull()
      expect(res.recommended?.hospital.id).toBe('hosp-cardio')
      expect(res.alternatives.length).toBe(1)
      expect(res.alternatives[0].hospital.id).toBe('hosp-gen')
      expect(res.alternatives[0].factors).toContain('general facility fallback for cardiac (+6)')
      expect(res.alternatives[0].factors).toContain('critical case with 0 ICU beds (+10)')
    })

    it('penalizes stale capacity telemetry (>60 minutes old)', async () => {
      const freshHosp: HospitalCandidate = {
        ...baseCandidate,
        id: 'fresh-1',
        name: 'Fresh Telemetry Hospital',
        last_updated: new Date().toISOString(),
      }

      const staleHosp: HospitalCandidate = {
        ...baseCandidate,
        id: 'stale-1',
        name: 'Stale Telemetry Hospital',
        last_updated: new Date(Date.now() - 90 * 60 * 1000).toISOString(), // 90 min old (>60m cutoff)
      }

      const res = await recommendHospital({
        pickup: { lat: 12.89, lng: 77.6 },
        emergencyType: 'cardiac',
        severity: 'medium',
        candidates: [staleHosp, freshHosp],
      })

      expect(res.recommended?.hospital.id).toBe('fresh-1')
      const staleAlternative = res.alternatives.find((a) => a.hospital.id === 'stale-1')
      expect(staleAlternative).toBeDefined()
      expect(staleAlternative?.factors).toContain('stale capacity telemetry (+5)')
    })

    it('returns empty recommendation when no candidates are operational', async () => {
      const closedHosp: HospitalCandidate = {
        ...baseCandidate,
        id: 'closed-1',
        is_operational: false,
      }

      const res = await recommendHospital({
        pickup: { lat: 12.89, lng: 77.6 },
        emergencyType: 'trauma',
        severity: 'high',
        candidates: [closedHosp],
      })

      expect(res.recommended).toBeNull()
      expect(res.alternatives).toEqual([])
      expect(res.filteredOut.length).toBe(1)
      expect(res.filteredOut[0].why).toContain('not operational')
    })
  })
})
