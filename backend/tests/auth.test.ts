import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { app } from '../src/app'
import { env } from '../src/config/env'
import { requireAuth, requireRole } from '../src/middleware/auth'
import { errorHandler } from '../src/middleware/errorHandler'
import { resetTestDb, closeTestPool, createUserToken } from './helpers'

describe('Auth Module & RBAC', () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  afterAll(async () => {
    await closeTestPool()
  })

  it('POST /auth/register successfully registers a new patient', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'testpatient@aidflow.demo',
        password: 'Password123!',
        name: 'Jane Patient',
        phone: '9876543210',
      })

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    expect(res.body.user).toMatchObject({
      email: 'testpatient@aidflow.demo',
      role: 'patient',
      name: 'Jane Patient',
      phone: '9876543210',
    })
  })

  it('POST /auth/register rejects duplicate email with 409 CONFLICT', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'testpatient@aidflow.demo',
        password: 'AnotherPassword123!',
        name: 'Duplicate Jane',
      })

    expect(res.status).toBe(409)
    expect(res.body.error).toHaveProperty('code', 'CONFLICT')
  })

  it('POST /auth/register validates password length (min 8 chars)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'shortpass@aidflow.demo',
        password: 'short',
        name: 'Short Pass',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toHaveProperty('code', 'VALIDATION')
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'password' }),
      ])
    )
  })

  it('POST /auth/login logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'testpatient@aidflow.demo',
        password: 'Password123!',
      })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body.user.email).toBe('testpatient@aidflow.demo')
  })

  it('POST /auth/login rejects incorrect password with 401 UNAUTHORIZED', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'testpatient@aidflow.demo',
        password: 'WrongPassword!',
      })

    expect(res.status).toBe(401)
    expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED')
  })

  it('GET /auth/me returns user profile with valid Bearer token', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: 'testpatient@aidflow.demo',
        password: 'Password123!',
      })

    const token = loginRes.body.token
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('testpatient@aidflow.demo')
    expect(res.body.user.role).toBe('patient')
  })

  it('GET /auth/me rejects missing or invalid token with 401', async () => {
    const noTokenRes = await request(app).get('/auth/me')
    expect(noTokenRes.status).toBe(401)
    expect(noTokenRes.body.error.code).toBe('UNAUTHORIZED')

    const badTokenRes = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer invalid.jwt.string')
    expect(badTokenRes.status).toBe(401)
    expect(badTokenRes.body.error.code).toBe('UNAUTHORIZED')
  })

  it('requireAuth rejects expired tokens with 401 Token has expired', async () => {
    const expiredToken = jwt.sign(
      { id: '00000000-0000-0000-0000-000000000001', email: 'p@aidflow.demo', role: 'patient' },
      env.JWT_SECRET,
      { expiresIn: '-1s' }
    )

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`)

    expect(res.status).toBe(401)
    expect(res.body.error.message).toMatch(/expired/i)
  })

  it('requireRole middleware permits authorized role and blocks unauthorized role with 403', async () => {
    const testApp = express()
    testApp.use(express.json())
    testApp.get('/admin-only', requireAuth, requireRole('admin'), (_req, res) => {
      res.json({ ok: true, access: 'admin' })
    })
    testApp.use(errorHandler)

    const patientToken = createUserToken({
      id: '00000000-0000-0000-0000-000000000002',
      email: 'patient@aidflow.demo',
      role: 'patient',
    })

    const adminToken = createUserToken({
      id: '00000000-0000-0000-0000-000000000003',
      email: 'admin@aidflow.demo',
      role: 'admin',
    })

    // Patient forbidden
    const patientRes = await request(testApp)
      .get('/admin-only')
      .set('Authorization', `Bearer ${patientToken}`)
    expect(patientRes.status).toBe(403)
    expect(patientRes.body.error.code).toBe('FORBIDDEN')

    // Admin allowed
    const adminRes = await request(testApp)
      .get('/admin-only')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(adminRes.status).toBe(200)
    expect(adminRes.body).toEqual({ ok: true, access: 'admin' })
  })
})
