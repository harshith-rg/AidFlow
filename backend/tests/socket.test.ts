import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { io as Client, type Socket as ClientSocket } from 'socket.io-client'
import { app } from '../src/app'
import { setupSocketIO } from '../src/realtime/socket'
import { emitToRoom } from '../src/realtime/events'
import { resetTestDb, closeTestPool, seedUser } from './helpers'
import request from 'supertest'

describe('Phase 7: Socket.IO Real-Time Gateway', () => {
  let server: http.Server
  let serverPort: number
  let adminToken: string
  let patient1Token: string
  let patient2Token: string
  let patient1CaseId: string

  beforeAll(async () => {
    await resetTestDb()
    const adm = await seedUser({ email: 'admin_sock@aidflow.demo', role: 'admin', name: 'Admin Sock' })
    adminToken = adm.token

    const p1 = await seedUser({ email: 'pat_sock1@aidflow.demo', role: 'patient', name: 'Patient Sock 1' })
    patient1Token = p1.token

    const p2 = await seedUser({ email: 'pat_sock2@aidflow.demo', role: 'patient', name: 'Patient Sock 2' })
    patient2Token = p2.token

    // Create a case owned by patient 1
    const createRes = await request(app)
      .post('/emergencies')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({
        type: 'cardiac',
        reporterName: 'Sock Patient 1',
        reporterPhone: '9888444333',
        pickup: { lat: 12.97, lng: 77.59 },
      })
    patient1CaseId = createRes.body.id

    // Start ephemeral HTTP server for socket tests
    server = http.createServer(app)
    setupSocketIO(server)
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any
        serverPort = addr.port
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await closeTestPool()
  })

  it('Rejects socket connection with an invalid token', async () => {
    // Note: an empty token is intentionally allowed (demo control-room access, see realtime/socket.ts),
    // so a malformed/invalid token is what must be rejected.
    const socket = Client(`http://localhost:${serverPort}`, {
      autoConnect: false,
      auth: { token: 'not-a-valid-jwt' },
    })

    const connectError = await new Promise<string>((resolve) => {
      socket.on('connect_error', (err) => {
        resolve(err.message)
      })
      socket.connect()
    })

    expect(connectError).toContain('Authentication error')
    socket.disconnect()
  })

  it('Authenticated user connects and receives role-scoped events', async () => {
    const adminSocket = Client(`http://localhost:${serverPort}`, {
      auth: { token: adminToken },
    })

    await new Promise<void>((resolve) => {
      adminSocket.on('connect', () => resolve())
    })

    expect(adminSocket.connected).toBe(true)

    // Verify room event arrival
    const eventPromise = new Promise<any>((resolve) => {
      adminSocket.on('alert:new', (data) => resolve(data))
    })

    emitToRoom('role:admin', 'alert:new', {
      id: 'test-alert-id',
      type: 'system',
      message: 'System test notification',
      createdAt: new Date().toISOString(),
      targetRole: 'admin',
    })

    const received = await eventPromise
    expect(received.id).toBe('test-alert-id')
    expect(received.message).toBe('System test notification')

    adminSocket.disconnect()
  })

  it('Patient cannot join another patient case room', async () => {
    const patient2Socket = Client(`http://localhost:${serverPort}`, {
      auth: { token: patient2Token },
    })

    await new Promise<void>((resolve) => {
      patient2Socket.on('connect', () => resolve())
    })

    // Patient 2 attempts to join patient 1's case room
    const errPromise = new Promise<string>((resolve) => {
      patient2Socket.on('error', (err) => resolve(err.message))
    })

    patient2Socket.emit('case:join', { caseId: patient1CaseId })

    const errMsg = await errPromise
    expect(errMsg).toContain('Forbidden')

    patient2Socket.disconnect()
  })

  it('Owner patient can join their own case room', async () => {
    const patient1Socket = Client(`http://localhost:${serverPort}`, {
      auth: { token: patient1Token },
    })

    await new Promise<void>((resolve) => {
      patient1Socket.on('connect', () => resolve())
    })

    const joinedPromise = new Promise<any>((resolve) => {
      patient1Socket.on('case:joined', (data) => resolve(data))
    })

    patient1Socket.emit('case:join', { caseId: patient1CaseId })

    const data = await joinedPromise
    expect(data.caseId).toBe(patient1CaseId)

    patient1Socket.disconnect()
  })
})
