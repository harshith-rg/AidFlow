import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { resetTestDb, closeTestPool } from './helpers'

describe('Health and Foundation API', () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  afterAll(async () => {
    await closeTestPool()
  })

  it('GET /health returns 200 with service and database up', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('status', 'ok')
    expect(res.body).toHaveProperty('database', 'up')
    expect(res.body).toHaveProperty('service', 'aidflow-backend')
    expect(res.body).toHaveProperty('time')
    expect(res.headers).toHaveProperty('x-request-id')
  })

  it('GET /non-existent-route returns 404 with unified error shape', async () => {
    const res = await request(app).get('/api/not-a-real-endpoint')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'No route for GET /api/not-a-real-endpoint',
      },
    })
    expect(res.headers).toHaveProperty('x-request-id')
  })

  it('Security headers from helmet are present', async () => {
    const res = await request(app).get('/health')
    expect(res.headers).toHaveProperty('x-dns-prefetch-control')
    expect(res.headers).toHaveProperty('x-content-type-options', 'nosniff')
  })

  it('X-Request-Id is preserved when provided in request header', async () => {
    const customId = 'req-trace-test-12345'
    const res = await request(app).get('/health').set('x-request-id', customId)
    expect(res.headers['x-request-id']).toBe(customId)
  })

  it('createUserToken helper generates verifiable JWT with role and payload', async () => {
    const { createUserToken } = await import('./helpers')
    const jwt = (await import('jsonwebtoken')).default
    const { env } = await import('../src/config/env')

    const token = createUserToken({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'driver1@aidflow.demo',
      role: 'driver',
    })
    expect(typeof token).toBe('string')

    const decoded = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown>
    expect(decoded.email).toBe('driver1@aidflow.demo')
    expect(decoded.role).toBe('driver')
  })

  it('seedAmbulance helper persists a test ambulance in the test database', async () => {
    const { seedAmbulance, testPool } = await import('./helpers')

    const id = await seedAmbulance({
      label: 'TEST-UNIT-99',
      lat: 12.9716,
      lng: 77.5946,
      status: 'available',
    })
    expect(id).toBeDefined()

    const check = await testPool.query('SELECT * FROM ambulances WHERE id = $1', [id])
    expect(check.rows.length).toBe(1)
    expect(check.rows[0].label).toBe('TEST-UNIT-99')
    expect(Number(check.rows[0].lat)).toBeCloseTo(12.9716)
    expect(Number(check.rows[0].lng)).toBeCloseTo(77.5946)
    expect(check.rows[0].is_test).toBe(true)
  })

  it('validate middleware enforces schema and returns unified VALIDATION error shape', async () => {
    const express = (await import('express')).default
    const { z } = await import('zod')
    const { validate } = await import('../src/middleware/validate')
    const { errorHandler } = await import('../src/middleware/errorHandler')

    const testApp = express()
    testApp.use(express.json())
    testApp.post(
      '/test-validate',
      validate({
        body: z.object({
          name: z.string().min(2, 'Name must be at least 2 chars'),
          count: z.number().int().positive(),
        }),
      }),
      (req, res) => res.json({ ok: true, data: req.body })
    )
    testApp.use(errorHandler)

    // Invalid payload
    const failRes = await request(testApp).post('/test-validate').send({ name: 'A' })
    expect(failRes.status).toBe(400)
    expect(failRes.body).toEqual({
      error: {
        code: 'VALIDATION',
        message: 'Some fields are invalid.',
        details: [
          { field: 'name', message: 'Name must be at least 2 chars' },
          { field: 'count', message: 'Required' },
        ],
      },
    })

    // Valid payload
    const passRes = await request(testApp).post('/test-validate').send({ name: 'Valid User', count: 5 })
    expect(passRes.status).toBe(200)
    expect(passRes.body).toEqual({ ok: true, data: { name: 'Valid User', count: 5 } })
  })
})

