import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from '../src/config/env'
import { PythonProvider } from '../src/modules/routing/providers/python'
import { getRoutingProvider } from '../src/modules/routing/router'

const FROM = { lat: 12.92, lng: 77.58 }
const TO = { lat: 12.961, lng: 77.601 }

const okBody = {
  status: 'ok',
  distance_km: 7.94,
  duration_min: 15.9,
  polyline: [
    [12.92, 77.58],
    [12.94, 77.59],
    [12.961, 77.601],
  ],
  source: 'python_astar',
  assumptions: { average_speed_kmh: 30, live_traffic: false, routing_algorithm: 'astar', demo_road_network: true },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('PythonProvider', () => {
  const originalUrl = env.PYTHON_ROUTING_URL
  const originalProvider = env.ROUTING_PROVIDER

  beforeEach(() => {
    env.PYTHON_ROUTING_URL = 'http://python-routing.test:8000/'
  })

  afterEach(() => {
    env.PYTHON_ROUTING_URL = originalUrl
    env.ROUTING_PROVIDER = originalProvider
    vi.restoreAllMocks()
  })

  it('calls POST /route with the coordinates and maps the response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(okBody))

    const result = await new PythonProvider().route(FROM, TO)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://python-routing.test:8000/route')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      origin_lat: 12.92,
      origin_lng: 77.58,
      destination_lat: 12.961,
      destination_lng: 77.601,
    })

    expect(result.source).toBe('python')
    expect(result.distanceKm).toBe(7.94)
    expect(result.durationMin).toBe(15.9)
    expect(result.geometry).toEqual([
      { lat: 12.92, lng: 77.58 },
      { lat: 12.94, lng: 77.59 },
      { lat: 12.961, lng: 77.601 },
    ])
    expect(result.assumptions).toContain('A*')
  })

  it('falls back to a labelled haversine estimate when the service returns an error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { code: 'OUT_OF_COVERAGE', message: 'outside coverage' } }, 422),
    )

    const result = await new PythonProvider().route(FROM, TO)

    expect(result.source).toBe('haversine')
    expect(result.distanceKm).toBeGreaterThan(0)
    expect(result.durationMin).toBeGreaterThanOrEqual(1)
    expect(result.assumptions).toContain('Python A* routing unavailable')
    expect(result.assumptions).toContain('HTTP 422')
  })

  it('falls back when the service is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))

    const result = await new PythonProvider().route(FROM, TO)

    expect(result.source).toBe('haversine')
    expect(result.assumptions).toContain('service unreachable')
  })

  it('falls back when the request times out', async () => {
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeout)

    const result = await new PythonProvider().route(FROM, TO)

    expect(result.source).toBe('haversine')
    expect(result.assumptions).toContain('request timed out')
  })

  it('passes a timeout signal to fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(okBody))

    await new PythonProvider().route(FROM, TO)

    expect(fetchSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('falls back when the response body is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ status: 'ok', distance_km: 'far' }))

    const result = await new PythonProvider().route(FROM, TO)

    expect(result.source).toBe('haversine')
    expect(result.assumptions).toContain('unexpected response')
  })

  it('falls back when the response is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>oops</html>', { status: 200 }))

    const result = await new PythonProvider().route(FROM, TO)

    expect(result.source).toBe('haversine')
    expect(result.assumptions).toContain('invalid JSON')
  })

  it('falls back without calling the network when PYTHON_ROUTING_URL is not set', async () => {
    env.PYTHON_ROUTING_URL = ''
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await new PythonProvider().route(FROM, TO)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).toBe('haversine')
    expect(result.assumptions).toContain('not configured')
  })

  it('is selected by the router when ROUTING_PROVIDER=python', () => {
    env.ROUTING_PROVIDER = 'python'
    expect(getRoutingProvider().name).toBe('python')
  })
})
