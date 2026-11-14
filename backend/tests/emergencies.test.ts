import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { resetTestDb, closeTestPool, seedUser, seedAmbulance } from './helpers'

describe('Emergencies API & Case Lifecycle', () => {
  let patientToken: string
  let otherPatientToken: string
  let adminToken: string
  let patientId = '11111111-1111-1111-1111-111111111111'
  let otherPatientId = '22222222-2222-2222-2222-222222222222'
  let adminId = '33333333-3333-3333-3333-333333333333'

  beforeAll(async () => {
    await resetTestDb()
    const p1 = await seedUser({ id: patientId, email: 'patient1@aidflow.demo', role: 'patient', name: 'Patient One' })
    patientToken = p1.token
    const p2 = await seedUser({ id: otherPatientId, email: 'patient2@aidflow.demo', role: 'patient', name: 'Patient Two' })
    otherPatientToken = p2.token
    const adm = await seedUser({ id: adminId, email: 'admin@aidflow.demo', role: 'admin', name: 'Admin User' })
    adminToken = adm.token
  })

  afterAll(async () => {
    await closeTestPool()
  })

  it('POST /emergencies creates an emergency case with valid case_code and status waiting', async () => {
    const payload = {
      type: 'cardiac',
      reporterName: 'John Doe',
      reporterPhone: '9876543210',
      description: 'Severe chest pain reported',
      pickup: { lat: 12.9716, lng: 77.5946, address: 'MG Road, Bangalore' },
    }

    const res = await request(app)
      .post('/emergencies')
      .set('Authorization', `Bearer ${patientToken}`)
      .send(payload)

    expect(res.status).toBe(201)
    expect(res.body.id).toMatch(/^EMG-\d{4}-\d{4}$/)
    expect(res.body.type).toBe('cardiac')
    expect(res.body.severity).toBe('critical') // auto-mapped from contract
    expect(res.body.status).toBe('waiting')
    expect(res.body.reporterName).toBe('John Doe')
    expect(res.body.reporterPhone).toBe('9876543210')
    expect(res.body.history.length).toBe(1)
    expect(res.body.history[0].status).toBe('waiting')
  })

  it('Duplicate emergency submission returns 409 CONFLICT', async () => {
    const payload = {
      type: 'cardiac',
      reporterName: 'John Doe',
      reporterPhone: '9876543210',
      description: 'Duplicate submit test',
      pickup: { lat: 12.9716, lng: 77.5946 },
    }

    const res = await request(app)
      .post('/emergencies')
      .set('Authorization', `Bearer ${patientToken}`)
      .send(payload)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toHaveProperty('existingCaseId')
  })

  it('Parallel case creation generates unique IDs without collision', async () => {
    const creates = Array.from({ length: 10 }).map((_, i) =>
      request(app)
        .post('/emergencies')
        .send({
          type: 'accident',
          reporterName: `Parallel Reporter ${i}`,
          reporterPhone: `987654321${i}`,
          pickup: { lat: 12.9000 + i * 0.01, lng: 77.5000 + i * 0.01 },
        })
    )

    const results = await Promise.all(creates)
    const ids = results.map((r) => r.body.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(10)
    for (const r of results) {
      expect(r.status).toBe(201)
      expect(r.body.id).toMatch(/^EMG-\d{4}-\d{4}$/)
    }
  })

  it('POST /emergencies rejects invalid coordinates and short reporter name', async () => {
    const badRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'cardiac',
        reporterName: 'A', // too short
        reporterPhone: '9876543210',
        pickup: { lat: 999, lng: 77.5946 }, // invalid lat
      })

    expect(badRes.status).toBe(400)
    expect(badRes.body.error.code).toBe('VALIDATION')
  })

  it('GET /emergencies/:id allows owner and admin, rejects unauthorized patient', async () => {
    // Create case by patient
    const createRes = await request(app)
      .post('/emergencies')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        type: 'stroke',
        reporterName: 'Owner Patient',
        reporterPhone: '9123456789',
        pickup: { lat: 13.0, lng: 77.6 },
      })
    const caseId = createRes.body.id

    // Owner reads: OK
    const ownerRes = await request(app)
      .get(`/emergencies/${caseId}`)
      .set('Authorization', `Bearer ${patientToken}`)
    expect(ownerRes.status).toBe(200)
    expect(ownerRes.body.id).toBe(caseId)

    // Admin reads: OK
    const adminRes = await request(app)
      .get(`/emergencies/${caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(adminRes.status).toBe(200)

    // Other patient reads: 403 Forbidden
    const otherRes = await request(app)
      .get(`/emergencies/${caseId}`)
      .set('Authorization', `Bearer ${otherPatientToken}`)
    expect(otherRes.status).toBe(403)
  })

  it('POST /emergencies/:id/cancel allows owner to cancel a waiting case', async () => {
    const createRes = await request(app)
      .post('/emergencies')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        type: 'burn',
        reporterName: 'Cancel Test',
        reporterPhone: '9988776655',
        pickup: { lat: 12.8, lng: 77.7 },
      })
    const caseId = createRes.body.id

    const cancelRes = await request(app)
      .post(`/emergencies/${caseId}/cancel`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ reason: 'Patient recovered, false alarm' })

    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.status).toBe('cancelled')
    expect(cancelRes.body.cancelReason).toBe('Patient recovered, false alarm')
  })

  it('POST /emergencies/:id/assign allows admin to manually assign an available ambulance', async () => {
    const ambId = await seedAmbulance({
      label: 'AMB-MANUAL-01',
      lat: 12.95,
      lng: 77.58,
      status: 'available',
    })

    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'trauma',
        reporterName: 'Trauma Case',
        reporterPhone: '9811223344',
        pickup: { lat: 12.951, lng: 77.581 },
      })
    const caseId = createRes.body.id

    const assignRes = await request(app)
      .post(`/emergencies/${caseId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ambulanceId: ambId })

    expect(assignRes.status).toBe(200)
    expect(assignRes.body.status).toBe('assigned')
    expect(assignRes.body.ambulance).toBeDefined()
    expect(assignRes.body.ambulance.id).toBe(ambId)
  })

  it('POST /emergencies/:id/complete allows admin to complete an assigned case', async () => {
    const ambId = await seedAmbulance({
      label: 'AMB-COMPLETE-01',
      lat: 12.92,
      lng: 77.56,
      status: 'available',
    })

    const createRes = await request(app)
      .post('/emergencies')
      .send({
        type: 'fracture',
        reporterName: 'Complete Case',
        reporterPhone: '9844332211',
        pickup: { lat: 12.921, lng: 77.561 },
      })
    const caseId = createRes.body.id

    // Assign first
    await request(app)
      .post(`/emergencies/${caseId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ambulanceId: ambId })

    // Complete
    const completeRes = await request(app)
      .post(`/emergencies/${caseId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(completeRes.status).toBe(200)
    expect(completeRes.body.status).toBe('completed')

    // Attempting to cancel an already completed case should fail with 409 CONFLICT
    const cancelAfterComplete = await request(app)
      .post(`/emergencies/${caseId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Try cancel completed' })

    expect(cancelAfterComplete.status).toBe(409)
    expect(cancelAfterComplete.body.error.code).toBe('CONFLICT')
  })

  it('Non-admin patient cannot complete a case (403 FORBIDDEN)', async () => {
    const createRes = await request(app)
      .post('/emergencies')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        type: 'poisoning',
        reporterName: 'Patient Poison',
        reporterPhone: '9776655443',
        pickup: { lat: 12.94, lng: 77.57 },
      })
    const caseId = createRes.body.id

    const completeRes = await request(app)
      .post(`/emergencies/${caseId}/complete`)
      .set('Authorization', `Bearer ${patientToken}`)

    expect(completeRes.status).toBe(403)
  })
})
