import http from 'node:http'
import { app } from '../src/app'
import { pool } from '../src/db/pool'

const PORT = 4000

async function runSmokeTest() {
  console.log('--- STARTING SMOKE TEST ---')
  const server = http.createServer(app)

  await new Promise<void>((resolve) => {
    server.listen(PORT, () => {
      console.log(`[SmokeTest] Server listening on http://localhost:${PORT}`)
      resolve()
    })
  })

  try {
    // 1. Health endpoint
    console.log('\n[1] Testing GET /health ...')
    const healthRes = await fetch(`http://localhost:${PORT}/health`, {
      headers: { 'x-request-id': 'smoke-test-req-001' },
    })
    const healthBody = await healthRes.json()
    console.log('Status:', healthRes.status)
    console.log('Headers x-request-id:', healthRes.headers.get('x-request-id'))
    console.log('Headers x-content-type-options:', healthRes.headers.get('x-content-type-options'))
    console.log('Body:', JSON.stringify(healthBody, null, 2))

    if (healthRes.status !== 200 || healthBody.database !== 'up') {
      throw new Error('Health check failed')
    }

    // 2. Hospitals endpoint
    console.log('\n[2] Testing GET /hospitals ...')
    const hospRes = await fetch(`http://localhost:${PORT}/hospitals`)
    const hospBody = await hospRes.json()
    console.log('Status:', hospRes.status)
    console.log('Returned hospitals count:', Array.isArray(hospBody) ? hospBody.length : 'not array')
    if (Array.isArray(hospBody) && hospBody.length > 0) {
      console.log('First hospital sample:', hospBody[0].name, '| Beds:', hospBody[0].beds)
    }

    if (hospRes.status !== 200 || !Array.isArray(hospBody) || hospBody.length === 0) {
      throw new Error('Hospitals endpoint failed')
    }

    // 3. 404 Unified Error Shape
    console.log('\n[3] Testing GET /unknown-route ...')
    const notFoundRes = await fetch(`http://localhost:${PORT}/unknown-route`)
    const notFoundBody = await notFoundRes.json()
    console.log('Status:', notFoundRes.status)
    console.log('Body:', JSON.stringify(notFoundBody, null, 2))

    if (notFoundRes.status !== 404 || notFoundBody.error?.code !== 'NOT_FOUND') {
      throw new Error('404 error shape test failed')
    }

    console.log('\n--- ALL SMOKE TESTS PASSED CLEANLY ---')
  } finally {
    server.close()
    await pool.end()
  }
}

runSmokeTest().catch((err) => {
  console.error('Smoke test failed with error:', err)
  process.exit(1)
})
