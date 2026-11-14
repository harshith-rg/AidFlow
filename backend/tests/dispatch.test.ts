import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { pool } from '../src/db/pool'
import { resetTestDb, closeTestPool, seedUser, seedAmbulance } from './helpers'
import { offerNext } from '../src/modules/dispatch/engine'
import { sweepExpiredAttempts } from '../src/modules/dispatch/scheduler'

describe('Phase 5: Dispatch Engine & Concurrency', () => {
  let adminToken: string
  let driver1Token: string
  let driver1Id: string
  let driver2Token: string
  let driver2Id: string

  beforeAll(async () => {
    await resetTestDb()
    const adm = await seedUser({ email: 'admin_disp@aidflow.demo', role: 'admin', name: 'Admin Disp' })
    adminToken = adm.token

    const d1 = await seedUser({ email: 'driver1@aidflow.demo', role: 'driver', name: 'Driver One' })
    driver1Token = d1.token
    driver1Id = d1.id

    const d2 = await seedUser({ email: 'driver2@aidflow.demo', role: 'driver', name: 'Driver Two' })
    driver2Token = d2.token
    driver2Id = d2.id
  })

  afterAll(async () => {
    await closeTestPool()
  })

  it('10 simultaneous accepts on one attempt results in exactly one 200 and nine 409s', async () => {
    const ambId = await seedAmbulance({
      label: 'AMB-CONC-01',
      lat: 12.9716,
      lng: 77.5946,
      status: 'available',
      driverId: driver1Id,
    })

    // Create case
    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'cardiac',
        reporterName: 'Concurrency Patient',
        reporterPhone: '9888111222',
        pickup: { lat: 12.972, lng: 77.595 },
      })
    const caseId = createRes.body.id

    // Offer to ambulance
    const offer = await offerNext(caseId)
    expect(offer).not.toBeNull()
    const attemptId = offer!.attemptId

    // 10 concurrent accept requests
    const acceptPromises = Array.from({ length: 10 }).map(() =>
      request(app)
        .post(`/dispatch/${attemptId}/accept`)
        .set('Authorization', `Bearer ${driver1Token}`)
    )

    const responses = await Promise.all(acceptPromises)
    const successCount = responses.filter((r) => r.status === 200).length
    const conflictCount = responses.filter((r) => r.status === 409).length

    expect(successCount).toBe(1)
    expect(conflictCount).toBe(9)

    // Verify ambulance marked busy and case assigned
    const ambCheck = await pool.query('SELECT status FROM ambulances WHERE id = $1', [ambId])
    expect(ambCheck.rows[0].status).toBe('busy')

    const caseCheck = await pool.query('SELECT status, assigned_ambulance_id FROM emergencies WHERE case_code = $1', [caseId])
    expect(caseCheck.rows[0].status).toBe('assigned')
    expect(caseCheck.rows[0].assigned_ambulance_id).toBe(ambId)
  })

  it('Accept after expiry returns 409 CONFLICT', async () => {
    const ambId = await seedAmbulance({
      label: 'AMB-EXPIRY-01',
      lat: 12.95,
      lng: 77.58,
      status: 'available',
      driverId: driver2Id,
    })

    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'stroke',
        reporterName: 'Expiry Patient',
        reporterPhone: '9888333444',
        pickup: { lat: 12.951, lng: 77.581 },
      })
    const caseId = createRes.body.id

    const offer = await offerNext(caseId)
    expect(offer).not.toBeNull()
    const attemptId = offer!.attemptId

    // Force attempt expiry in the DB
    await pool.query(
      "UPDATE dispatch_attempts SET offered_at = now() - INTERVAL '20 seconds', expires_at = now() - INTERVAL '5 seconds' WHERE id = $1",
      [attemptId]
    )

    const res = await request(app)
      .post(`/dispatch/${attemptId}/accept`)
      .set('Authorization', `Bearer ${driver2Token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('Reject chain walks candidates in ranking order', async () => {
    // Take any leftover available ambulances offline to isolate ranking test
    await pool.query("UPDATE ambulances SET status = 'offline' WHERE status = 'available'")

    // Seed 3 ambulances at increasing distances from pickup
    const d3 = await seedUser({ email: 'driver3@aidflow.demo', role: 'driver', name: 'Driver Three' })
    const d4 = await seedUser({ email: 'driver4@aidflow.demo', role: 'driver', name: 'Driver Four' })
    const d5 = await seedUser({ email: 'driver5@aidflow.demo', role: 'driver', name: 'Driver Five' })

    const ambA = await seedAmbulance({ label: 'AMB-RANK-A', lat: 12.9717, lng: 77.5947, driverId: d3.id }) // closest (~0.1km)
    const ambB = await seedAmbulance({ label: 'AMB-RANK-B', lat: 12.98, lng: 77.60, driverId: d4.id }) // medium (~1.5km)
    const ambC = await seedAmbulance({ label: 'AMB-RANK-C', lat: 13.01, lng: 77.62, driverId: d5.id }) // farthest (~6km)

    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'breathing',
        reporterName: 'Walk Patient',
        reporterPhone: '9888555666',
        pickup: { lat: 12.9716, lng: 77.5946 },
      })
    const caseId = createRes.body.id

    // Offer 1 -> should be closest ambA
    const offer1 = await offerNext(caseId)
    expect(offer1!.ambulanceId).toBe(ambA)

    // Reject 1
    await request(app)
      .post(`/dispatch/${offer1!.attemptId}/reject`)
      .set('Authorization', `Bearer ${d3.token}`)
      .send({ reason: 'Flat tire' })

    // Next offer -> should be ambB
    const offer2Res = await pool.query(
      `SELECT * FROM dispatch_attempts WHERE emergency_id = (SELECT id FROM emergencies WHERE case_code = $1) AND outcome = 'pending'`,
      [caseId]
    )
    expect(offer2Res.rows.length).toBe(1)
    expect(offer2Res.rows[0].ambulance_id).toBe(ambB)

    // Reject 2
    await request(app)
      .post(`/dispatch/${offer2Res.rows[0].id}/reject`)
      .set('Authorization', `Bearer ${d4.token}`)

    // Next offer -> should be ambC
    const offer3Res = await pool.query(
      `SELECT * FROM dispatch_attempts WHERE emergency_id = (SELECT id FROM emergencies WHERE case_code = $1) AND outcome = 'pending'`,
      [caseId]
    )
    expect(offer3Res.rows.length).toBe(1)
    expect(offer3Res.rows[0].ambulance_id).toBe(ambC)
  })

  it('Sweeper expires an offer and transitions attempt to timed_out', async () => {
    // Take previous ambulances offline to isolate
    await pool.query("UPDATE ambulances SET status = 'offline' WHERE status = 'available'")

    const d6 = await seedUser({ email: 'driver6@aidflow.demo', role: 'driver', name: 'Driver Six' })
    const amb = await seedAmbulance({ label: 'AMB-SWEEP-01', lat: 12.93, lng: 77.61, driverId: d6.id })

    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'poisoning',
        reporterName: 'Sweeper Patient',
        reporterPhone: '9888777888',
        pickup: { lat: 12.931, lng: 77.611 },
      })
    const caseId = createRes.body.id

    const offer = await offerNext(caseId)
    expect(offer).not.toBeNull()

    // Manually expire in DB
    await pool.query(
      "UPDATE dispatch_attempts SET offered_at = now() - INTERVAL '20 seconds', expires_at = now() - INTERVAL '2 seconds' WHERE id = $1",
      [offer!.attemptId]
    )

    // Trigger sweeper directly
    const swept = await sweepExpiredAttempts()
    expect(swept).toBeGreaterThanOrEqual(1)

    const checkRes = await pool.query('SELECT outcome FROM dispatch_attempts WHERE id = $1', [offer!.attemptId])
    expect(checkRes.rows[0].outcome).toBe('timed_out')
  })

  it('Manual assign during pending offer overrides the offer and cancels it', async () => {
    const d7 = await seedUser({ email: 'driver7@aidflow.demo', role: 'driver', name: 'Driver Seven' })
    const ambOffered = await seedAmbulance({ label: 'AMB-OFFERED', lat: 12.94, lng: 77.58, driverId: d7.id })
    const ambOverride = await seedAmbulance({ label: 'AMB-OVERRIDE', lat: 12.942, lng: 77.582 })

    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'fracture',
        reporterName: 'Override Patient',
        reporterPhone: '9888999000',
        pickup: { lat: 12.941, lng: 77.581 },
      })
    const caseId = createRes.body.id

    const offer = await offerNext(caseId)
    expect(offer).not.toBeNull()

    // Admin manually assigns ambOverride
    const assignRes = await request(app)
      .post(`/emergencies/${caseId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ambulanceId: ambOverride })

    expect(assignRes.status).toBe(200)
    expect(assignRes.body.status).toBe('assigned')
    expect(assignRes.body.ambulance.id).toBe(ambOverride)

    // The previously pending attempt should now be rejected (overridden)
    const oldAttempt = await pool.query('SELECT outcome FROM dispatch_attempts WHERE id = $1', [offer!.attemptId])
    expect(oldAttempt.rows[0].outcome).toBe('rejected')
  })
})
