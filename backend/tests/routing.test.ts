import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { resetTestDb, closeTestPool, seedUser } from './helpers'
import { HaversineProvider } from '../src/modules/routing/providers/haversine'
import { GraphProvider } from '../src/modules/routing/providers/graph'
import { OsrmProvider } from '../src/modules/routing/providers/osrm'
import { OrsProvider } from '../src/modules/routing/providers/ors'
import { runDijkstra } from '../src/modules/routing/algorithms/dijkstra'
import { runAStar } from '../src/modules/routing/algorithms/astar'
import { DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES } from '../src/modules/routing/data/graphData'
import { recommendHospital, type HospitalCandidate } from '../src/modules/routing/recommend'

describe('Phase 4: Routing, ETA, and Hospital Recommendation', () => {
  let adminToken: string

  beforeAll(async () => {
    await resetTestDb()
    const user = await seedUser({
      email: 'admin_routing@aidflow.demo',
      role: 'admin',
      name: 'Admin Routing',
    })
    adminToken = user.token
  })

  afterAll(async () => {
    await closeTestPool()
  })

  describe('1. Routing Providers & Algorithms', () => {
    it('HaversineProvider produces distance with 1.3 factor, valid ETA, and honest assumptions', async () => {
      const provider = new HaversineProvider()
      const from = { lat: 12.9716, lng: 77.5946 } // MG Road
      const to = { lat: 12.9352, lng: 77.6245 } // Koramangala

      const res = await provider.route(from, to)
      expect(res.source).toBe('haversine')
      expect(res.distanceKm).toBeGreaterThan(4)
      expect(res.distanceKm).toBeLessThan(10)
      expect(res.durationMin).toBeGreaterThan(0)
      expect(res.assumptions).toContain('Estimate, not road-accurate')
      expect(res.assumptions).toContain('1.3 road-winding factor')
      expect(res.geometry.length).toBe(2)
    })

    it('GraphProvider builds the ambulance-to-emergency route with Dijkstra', async () => {
      const result = await new GraphProvider().route(
        { lat: 12.9716, lng: 77.5946 },
        { lat: 12.9352, lng: 77.6245 },
      )
      expect(result.source).toBe('graph')
      expect(result.geometry.length).toBeGreaterThan(2)
      expect(result.durationMin).toBeGreaterThan(0)
      expect(result.assumptions).toContain('Dijkstra')
    })

    it('Dijkstra and A* return identical shortest distance across all test pairs', () => {
      const pairs: [string, string][] = [
        ['N1', 'N5'],
        ['N6', 'N2'],
        ['N4', 'N10'],
        ['N3', 'N5'],
      ]

      for (const [start, end] of pairs) {
        const dRes = runDijkstra(start, end, DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES)
        const aRes = runAStar(start, end, DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES)

        expect(dRes.path.length).toBeGreaterThan(0)
        expect(aRes.path.length).toBeGreaterThan(0)
        expect(dRes.distanceKm).toBe(aRes.distanceKm)
        // A* should expand fewer or equal nodes than Dijkstra
        expect(aRes.nodesExpanded).toBeLessThanOrEqual(dRes.nodesExpanded)
      }
    })

    it('OSRM and ORS providers gracefully fall back to Haversine without crashing', async () => {
      const osrm = new OsrmProvider()
      const ors = new OrsProvider()

      const from = { lat: 12.9716, lng: 77.5946 }
      const to = { lat: 12.9352, lng: 77.6245 }

      const osrmRes = await osrm.route(from, to)
      expect(osrmRes.source).toBe('haversine')
      expect(osrmRes.assumptions).toContain('Fallback to Haversine')

      const orsRes = await ors.route(from, to)
      expect(orsRes.source).toBe('haversine')
      expect(orsRes.assumptions).toContain('Fallback to Haversine')
    })
  })

  describe('2. Hospital Recommendation Pipeline', () => {
    const candidates: HospitalCandidate[] = [
      {
        id: 'hosp-1',
        name: 'Heart Specialized Centre',
        lat: 12.972,
        lng: 77.595,
        is_operational: true,
        capacity_status: 'available',
        beds: 30,
        icu_beds: 5,
        specialties: ['cardiology'],
        last_updated: new Date().toISOString(),
      },
      {
        id: 'hosp-2',
        name: 'General Community Clinic',
        lat: 12.9718,
        lng: 77.5948, // slightly closer
        is_operational: true,
        capacity_status: 'available',
        beds: 10,
        icu_beds: 0,
        specialties: ['general'],
        last_updated: new Date().toISOString(),
      },
      {
        id: 'hosp-3',
        name: 'Full Capacity Hospital',
        lat: 12.9716,
        lng: 77.5946,
        is_operational: true,
        capacity_status: 'full',
        beds: 0,
        icu_beds: 0,
        specialties: ['cardiology', 'general'],
        last_updated: new Date().toISOString(),
      },
      {
        id: 'hosp-4',
        name: 'Closed Hospital',
        lat: 12.9716,
        lng: 77.5946,
        is_operational: false,
        capacity_status: 'available',
        beds: 20,
        icu_beds: 2,
        specialties: ['cardiology'],
        last_updated: new Date().toISOString(),
      },
      {
        id: 'hosp-5',
        name: 'Stale Telemetry Hospital',
        lat: 12.9721,
        lng: 77.5951,
        is_operational: true,
        capacity_status: 'available',
        beds: 20,
        icu_beds: 3,
        specialties: ['cardiology'],
        last_updated: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), // 48h stale
      },
    ]

    it('Filters out full capacity, non-operational, and missing specialties', async () => {
      const res = await recommendHospital({
        pickup: { lat: 12.9716, lng: 77.5946 },
        emergencyType: 'cardiac',
        severity: 'critical',
        candidates,
      })

      expect(res.recommended).toBeDefined()
      expect(res.recommended!.hospital.id).toBe('hosp-1') // Heart Specialized Centre

      const filteredIds = res.filteredOut.map((f) => f.hospitalId)
      expect(filteredIds).toContain('hosp-3') // full capacity
      expect(filteredIds).toContain('hosp-4') // not operational
    })

    it('Applies penalties for general fallback and 0 ICU beds in critical cases', async () => {
      const res = await recommendHospital({
        pickup: { lat: 12.9716, lng: 77.5946 },
        emergencyType: 'cardiac',
        severity: 'critical',
        candidates: [candidates[0], candidates[1]], // hosp-1 (cardio, 5 ICU) vs hosp-2 (general, 0 ICU)
      })

      // hosp-1 should clearly win despite hosp-2 being slightly closer
      expect(res.recommended!.hospital.id).toBe('hosp-1')
      const generalCandidate = res.alternatives.find((a) => a.hospital.id === 'hosp-2')
      expect(generalCandidate).toBeDefined()
      // hosp-2 should have penalties for general fallback (+6) and 0 ICU beds for critical (+10)
      expect(generalCandidate!.factors).toContain('general facility fallback for cardiac (+6)')
      expect(generalCandidate!.factors).toContain('critical case with 0 ICU beds (+10)')
      expect(generalCandidate!.score).toBeGreaterThan(res.recommended!.score + 10)
    })

    it('Penalizes stale capacity telemetry (+5)', async () => {
      const res = await recommendHospital({
        pickup: { lat: 12.9716, lng: 77.5946 },
        emergencyType: 'cardiac',
        severity: 'high',
        candidates: [candidates[0], candidates[4]], // fresh vs stale
      })

      expect(res.recommended!.hospital.id).toBe('hosp-1')
      const staleAlternative = res.alternatives.find((a) => a.hospital.id === 'hosp-5')
      expect(staleAlternative).toBeDefined()
      expect(staleAlternative!.factors).toContain('stale capacity telemetry (+5)')
    })

    it('Empty candidate list returns recommended: null gracefully without crashing', async () => {
      const res = await recommendHospital({
        pickup: { lat: 12.9716, lng: 77.5946 },
        emergencyType: 'burn',
        severity: 'high',
        candidates: [],
      })

      expect(res.recommended).toBeNull()
      expect(res.alternatives).toEqual([])
      expect(res.reason).toContain('No suitable hospital found')
    })

    it('Invalid coordinates throw 400 badRequest', async () => {
      await expect(
        recommendHospital({
          pickup: { lat: 999, lng: 77.5946 },
          emergencyType: 'cardiac',
          severity: 'high',
          candidates,
        })
      ).rejects.toThrow()
    })
  })

  describe('3. GET /hospitals/recommend API Endpoint', () => {
    it('Requires authentication and returns recommendation', async () => {
      // Unauthenticated fails with 401
      const unauthRes = await request(app).get('/hospitals/recommend?lat=12.9716&lng=77.5946&type=cardiac')
      expect(unauthRes.status).toBe(401)

      // Authenticated succeeds with 200
      const res = await request(app)
        .get('/hospitals/recommend?lat=12.9716&lng=77.5946&type=cardiac&severity=critical')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('recommended')
      expect(res.body).toHaveProperty('reason')
      expect(res.body).toHaveProperty('distanceKm')
      expect(res.body).toHaveProperty('etaMinutes')
      expect(res.body).toHaveProperty('geometry')
    })
  })
})
