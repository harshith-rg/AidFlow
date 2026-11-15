import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { pool } from '../src/db/pool'
import { resetTestDb, closeTestPool, seedUser, seedAmbulance } from './helpers'
import { offerNext } from '../src/modules/dispatch/engine'

describe('Section 5: Simulated Dummy-Number Helpline & Driver IVR', () => {
  let adminToken: string
  let adminId: string
  let patientToken: string
  let driver1Token: string
  let driver1Id: string
  let driver2Token: string
  let driver2Id: string

  beforeAll(async () => {
    await resetTestDb()
    const adm = await seedUser({ email: 'admin_tel@aidflow.demo', role: 'admin', name: 'Admin Tel' })
    adminToken = adm.token
    adminId = adm.id

    const pat = await seedUser({ email: 'patient_tel@aidflow.demo', role: 'patient', name: 'Patient Tel' })
    patientToken = pat.token

    const d1 = await seedUser({ email: 'driver_tel1@aidflow.demo', role: 'driver', name: 'Driver Tel 1' })
    driver1Token = d1.token
    driver1Id = d1.id

    const d2 = await seedUser({ email: 'driver_tel2@aidflow.demo', role: 'driver', name: 'Driver Tel 2' })
    driver2Token = d2.token
    driver2Id = d2.id
  })

  afterAll(async () => {
    await closeTestPool()
  })

  it('GET /telephony/config returns demo helpline number and simulated notice', async () => {
    const res = await request(app).get('/telephony/config')
    expect(res.status).toBe(200)
    expect(res.body.helplineNumber).toBe('1800-000-0000')
    expect(res.body.simulated).toBe(true)
    expect(res.body.notice).toContain('100% simulated')
  })

  it('Inbound call can be answered and registered as an emergency with source=call', async () => {
    // 1. Caller dials simulated helpline
    const dialRes = await request(app)
      .post('/calls/incoming')
      .send({
        callerNumber: '9988001122',
        callerName: 'Grandma Maria',
        lat: 12.9716,
        lng: 77.5946,
      })

    expect(dialRes.status).toBe(201)
    expect(dialRes.body.direction).toBe('inbound_caller')
    expect(dialRes.body.status).toBe('ringing')
    expect(dialRes.body.simulated).toBe(true)
    const callId = dialRes.body.id

    // 2. Non-admin cannot answer (403)
    const badAnswer = await request(app)
      .post(`/calls/${callId}/answer`)
      .set('Authorization', `Bearer ${patientToken}`)
    expect(badAnswer.status).toBe(403)

    // 3. Admin answers call
    const answerRes = await request(app)
      .post(`/calls/${callId}/answer`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(answerRes.status).toBe(200)
    expect(answerRes.body.status).toBe('in_progress')
    expect(answerRes.body.answered_by).toBe(adminId)

    // 4. Admin registers emergency from active call
    const regRes = await request(app)
      .post(`/calls/${callId}/register-emergency`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'cardiac',
        reporterName: 'Grandma Maria',
        reporterPhone: '9988001122',
        description: 'Unresponsive after fainting',
        pickup: { lat: 12.9716, lng: 77.5946, address: 'Near Central Post Office' },
      })

    expect(regRes.status).toBe(201)
    expect(regRes.body.id).toMatch(/^EMG-\d{4}-\d{4}$/)
    expect(regRes.body.source).toBe('call')

    // 5. Verify call session was linked to emergency case
    const callCheck = await pool.query('SELECT emergency_id FROM call_sessions WHERE id = $1', [callId])
    expect(callCheck.rows[0].emergency_id).toBeDefined()
  })

  it('Driver IVR: Outbound call session accepts offer via DTMF 1', async () => {
    const ambId = await seedAmbulance({
      label: 'AMB-IVR-01',
      lat: 12.96,
      lng: 77.60,
      driverId: driver1Id,
    })

    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'stroke',
        reporterName: 'IVR Patient',
        reporterPhone: '9888123456',
        pickup: { lat: 12.961, lng: 77.601 },
      })
    const caseId = createRes.body.id

    const offer = await offerNext(caseId)
    expect(offer).not.toBeNull()

    // Find outbound driver call session created for this attempt
    const callRes = await pool.query(
      `SELECT id, status, ambulance_id FROM call_sessions
       WHERE dispatch_attempt_id = $1 AND direction = 'outbound_driver'`,
      [offer!.attemptId]
    )
    expect(callRes.rows.length).toBe(1)
    const ivrCallId = callRes.rows[0].id
    expect(callRes.rows[0].status).toBe('ringing')

    // Unauthorized driver cannot press DTMF (403)
    const forbidDtmf = await request(app)
      .post(`/calls/${ivrCallId}/dtmf`)
      .set('Authorization', `Bearer ${driver2Token}`)
      .send({ digit: '1' })
    expect(forbidDtmf.status).toBe(403)

    // Authorized driver presses '1' (Accept)
    const acceptDtmf = await request(app)
      .post(`/calls/${ivrCallId}/dtmf`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ digit: '1' })

    expect(acceptDtmf.status).toBe(200)
    expect(acceptDtmf.body.action).toBe('accepted')

    // Verify case is now assigned and attempt is accepted
    const caseCheck = await pool.query('SELECT status, assigned_ambulance_id FROM emergencies WHERE case_code = $1', [caseId])
    expect(caseCheck.rows[0].status).toBe('assigned')
    expect(caseCheck.rows[0].assigned_ambulance_id).toBe(ambId)
  })

  it('Driver IVR: DTMF 2 rejects offer and offers to next candidate', async () => {
    await pool.query(
  "UPDATE ambulances SET status = 'offline' WHERE status = 'available'"
  )
    const drRej1 = await seedUser({ email: 'driver_rej1@aidflow.demo', role: 'driver', name: 'Driver Rej 1' })
    const drRej2 = await seedUser({ email: 'driver_rej2@aidflow.demo', role: 'driver', name: 'Driver Rej 2' })
    const amb1 = await seedAmbulance({ label: 'AMB-REJ-01', lat: 12.92, lng: 77.58, driverId: drRej1.id })
    const amb2 = await seedAmbulance({ label: 'AMB-REJ-02', lat: 12.93, lng: 77.59, driverId: drRej2.id })

    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'burn',
        reporterName: 'DTMF Rej Patient',
        reporterPhone: '9444555666',
        pickup: { lat: 12.921, lng: 77.581 },
      })
    const caseId = createRes.body.id

    const offer1 = await offerNext(caseId)
    expect(offer1!.ambulanceId).toBe(amb1)

    const callRes = await pool.query(
      'SELECT id FROM call_sessions WHERE dispatch_attempt_id = $1',
      [offer1!.attemptId]
    )
    const callId = callRes.rows[0].id

    // Driver 1 presses '2' (Reject)
    const rejRes = await request(app)
      .post(`/calls/${callId}/dtmf`)
      .set('Authorization', `Bearer ${drRej1.token}`)
      .send({ digit: '2' })

    expect(rejRes.status).toBe(200)
    expect(rejRes.body.action).toBe('rejected')

    // Verify next offer automatically created for amb2
    const nextAttempt = await pool.query(
      `SELECT da.ambulance_id, da.outcome
       FROM dispatch_attempts da
       JOIN emergencies e ON da.emergency_id = e.id
       WHERE e.case_code = $1 AND da.outcome = 'pending'`,
      [caseId]
    )
    expect(nextAttempt.rows.length).toBe(1)
    expect(nextAttempt.rows[0].ambulance_id).toBe(amb2)
  })
})
