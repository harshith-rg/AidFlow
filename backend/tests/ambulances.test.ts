import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { resetTestDb, closeTestPool, seedUser, seedAmbulance } from './helpers'
import { pool } from '../src/db/pool'

describe('Phase 6: Ambulances, Location, Hospital Status & Simulation', () => {
  let adminToken: string
  let driverToken: string
  let driverId: string
  let hospitalToken: string
  let hospitalId: string
  let otherHospitalToken: string
  let otherHospitalId: string

  beforeAll(async () => {
    await resetTestDb()
    const adm = await seedUser({ email: 'admin_amb@aidflow.demo', role: 'admin', name: 'Admin Amb' })
    adminToken = adm.token

    const d = await seedUser({ email: 'driver_amb@aidflow.demo', role: 'driver', name: 'Driver Amb' })
    driverToken = d.token
    driverId = d.id

    // Seed 2 demo hospitals
    const h1 = await pool.query(
      `INSERT INTO hospitals (name, lat, lng, capacity_status, beds, icu_beds, is_operational, is_demo)
       VALUES ('Hospital Alpha', 12.97, 77.59, 'available', 20, 4, TRUE, TRUE) RETURNING id`
    )
    hospitalId = h1.rows[0].id

    const h2 = await pool.query(
      `INSERT INTO hospitals (name, lat, lng, capacity_status, beds, icu_beds, is_operational, is_demo)
       VALUES ('Hospital Beta', 12.98, 77.60, 'available', 15, 2, TRUE, TRUE) RETURNING id`
    )
    otherHospitalId = h2.rows[0].id

    const hospUser1 = await seedUser({
      email: 'hosp1@aidflow.demo',
      role: 'hospital',
      name: 'Hospital Desk Alpha',
      hospitalId,
    })
    hospitalToken = hospUser1.token

    const hospUser2 = await seedUser({
      email: 'hosp2@aidflow.demo',
      role: 'hospital',
      name: 'Hospital Desk Beta',
      hospitalId: otherHospitalId,
    })
    otherHospitalToken = hospUser2.token
  })

  afterAll(async () => {
    await closeTestPool()
  })

  describe('1. Ambulance Availability & Active Case Protection', () => {
    it('Cannot set ambulance offline while assigned to an active case (409 CONFLICT)', async () => {
      const ambId = await seedAmbulance({
        label: 'AMB-BUSY-01',
        lat: 12.9716,
        lng: 77.5946,
        status: 'available',
        driverId,
      })

      // Create and assign case
      const createRes = await request(app)
        .post('/emergencies')
        .send({
          type: 'cardiac',
          reporterName: 'Busy Amb Patient',
          reporterPhone: '9111222333',
          pickup: { lat: 12.972, lng: 77.595 },
        })
      const caseId = createRes.body.id

      await request(app)
        .post(`/emergencies/${caseId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ambulanceId: ambId })

      // Driver attempts to set ambulance offline
      const offRes = await request(app)
        .patch(`/ambulances/${ambId}/availability`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'offline' })

      expect(offRes.status).toBe(409)
      expect(offRes.body.error.code).toBe('CONFLICT')
    })
  })

  describe('2. Location Telemetry: Monotonic Timestamps & Out-of-Order Rules', () => {
    it('Ignores stale location update older than last_location_at and returns applied: false', async () => {
      const dLoc = await seedUser({ email: 'driver_loc@aidflow.demo', role: 'driver', name: 'Driver Loc' })
      const ambId = await seedAmbulance({
        label: 'AMB-LOC-01',
        lat: 12.95,
        lng: 77.58,
        driverId: dLoc.id,
      })

      const now = new Date()
      // Send fresh update
      const res1 = await request(app)
        .patch(`/ambulances/${ambId}/location`)
        .set('Authorization', `Bearer ${dLoc.token}`)
        .send({ lat: 12.951, lng: 77.581, timestamp: now.toISOString() })

      expect(res1.status).toBe(200)
      expect(res1.body.applied).toBe(true)

      // Send older (stale) update
      const olderTime = new Date(now.getTime() - 60000) // 1 min in the past
      const res2 = await request(app)
        .patch(`/ambulances/${ambId}/location`)
        .set('Authorization', `Bearer ${dLoc.token}`)
        .send({ lat: 12.952, lng: 77.582, timestamp: olderTime.toISOString() })

      expect(res2.status).toBe(200)
      expect(res2.body.applied).toBe(false)
      expect(res2.body.reason).toBe('stale')
    })

    it('Rejects timestamps more than 5 minutes in the future (400)', async () => {
      const dFut = await seedUser({ email: 'driver_fut@aidflow.demo', role: 'driver', name: 'Driver Fut' })
      const ambId = await seedAmbulance({ label: 'AMB-FUT-01', lat: 12.95, lng: 77.58, driverId: dFut.id })

      const futureTime = new Date(Date.now() + 10 * 60 * 1000) // 10 min in future
      const res = await request(app)
        .patch(`/ambulances/${ambId}/location`)
        .set('Authorization', `Bearer ${dFut.token}`)
        .send({ lat: 12.951, lng: 77.581, timestamp: futureTime.toISOString() })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION')
    })
  })

  describe('3. Hospital Status Scoping & Capacity Updates', () => {
    it('Hospital user can update own hospital status, but is forbidden from updating another hospital', async () => {
      // Hosp 1 user updates Hosp 1: OK
      const okRes = await request(app)
        .patch(`/hospitals/${hospitalId}/status`)
        .set('Authorization', `Bearer ${hospitalToken}`)
        .send({ capacity_status: 'limited', beds: 8, icu_beds: 1 })

      expect(okRes.status).toBe(200)
      expect(okRes.body.capacityStatus).toBe('limited')
      expect(okRes.body.beds).toBe(8)

      // Hosp 1 user attempts to update Hosp 2: 403 Forbidden
      const forbidRes = await request(app)
        .patch(`/hospitals/${otherHospitalId}/status`)
        .set('Authorization', `Bearer ${hospitalToken}`)
        .send({ capacity_status: 'full' })

      expect(forbidRes.status).toBe(403)
      expect(forbidRes.body.error.code).toBe('FORBIDDEN')

      // Admin can update any hospital: OK
      const adminRes = await request(app)
        .patch(`/hospitals/${otherHospitalId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ capacity_status: 'available', beds: 18 })

      expect(adminRes.status).toBe(200)
      expect(adminRes.body.capacityStatus).toBe('available')
    })
  })

  describe('4. Simulation Endpoint', () => {
    it('POST /simulation/ambulances/:id/follow-case starts path progression', async () => {
      const ambId = await seedAmbulance({ label: 'AMB-SIM-01', lat: 12.97, lng: 77.59 })

      const createRes = await request(app)
        .post('/emergencies')
        .send({
          type: 'accident',
          reporterName: 'Sim Patient',
          reporterPhone: '9333444555',
          pickup: { lat: 12.98, lng: 77.60 },
        })
      const caseId = createRes.body.id

      const simRes = await request(app)
        .post(`/simulation/ambulances/${ambId}/follow-case`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ caseId, intervalMs: 200 })

      expect(simRes.status).toBe(200)
      expect(simRes.body.started).toBe(true)
      expect(simRes.body.totalWaypoints).toBeGreaterThan(0)

      // Stop simulation
      const stopRes = await request(app)
        .post('/simulation/stop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ambulanceId: ambId })

      expect(stopRes.status).toBe(200)
      expect(stopRes.body.stopped).toBe(1)
    })
  })
})
