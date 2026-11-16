import { useCallback, useEffect, useMemo, useState } from 'react'

type Coordinates = { lat: number; lng: number }

type LiveLocationMapProps = {
  mapTypeId?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain'
  zoom?: number
  height?: number
  onLocationChange?: (coords: Coordinates) => void
}

type Tile = { x: number; y: number; urlX: number; urlY: number; left: number; top: number }

const TILE_SIZE = 256
const TILE_RADIUS = 2
const FALLBACK: Coordinates = { lat: 12.9716, lng: 77.5946 }

function coordinateToTile(coords: Coordinates, zoom: number) {
  const scale = 2 ** zoom
  const lat = Math.max(-85.0511, Math.min(85.0511, coords.lat))
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const x = ((coords.lng + 180) / 360) * scale
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  return { x, y }
}

/**
 * A lightweight satellite map using Esri World Imagery tiles. It does not
 * require a Google Maps API key or Google billing to display imagery.
 */
export default function LiveLocationMap({
  mapTypeId = 'satellite',
  zoom: initialZoom = 16,
  height = 240,
  onLocationChange,
}: LiveLocationMapProps) {
  const [center, setCenter] = useState<Coordinates>(FALLBACK)
  const [zoom, setZoom] = useState(Math.max(3, Math.min(19, initialZoom)))
  const [locationMessage, setLocationMessage] = useState('Finding your location…')
  const [tileError, setTileError] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!navigator.geolocation) {
      setLocationMessage('Showing Bengaluru as a fallback location')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        const next = { lat: position.coords.latitude, lng: position.coords.longitude }
        setCenter(next)
        setLocationMessage('Satellite imagery')
        onLocationChange?.(next)
      },
      () => {
        if (cancelled) return
        setLocationMessage('Location permission unavailable — showing Bengaluru')
        onLocationChange?.(FALLBACK)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    )
    return () => { cancelled = true }
  }, [onLocationChange])

  const tiles = useMemo<Tile[]>(() => {
    const centerTile = coordinateToTile(center, zoom)
    const baseX = Math.floor(centerTile.x)
    const baseY = Math.floor(centerTile.y)
    const count = 2 ** zoom
    const list: Tile[] = []
    for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy += 1) {
      for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx += 1) {
        const x = baseX + dx
        const y = baseY + dy
        if (y < 0 || y >= count) continue
        const wrappedX = ((x % count) + count) % count
        list.push({
          x,
          y,
          urlX: wrappedX,
          urlY: y,
          left: (x - centerTile.x) * TILE_SIZE,
          top: (y - centerTile.y) * TILE_SIZE,
        })
      }
    }
    return list
  }, [center, zoom])

  const nudge = useCallback((dx: number, dy: number) => {
    const scale = 2 ** zoom
    const tile = coordinateToTile(center, zoom)
    const x = tile.x + dx * 0.65
    const y = tile.y + dy * 0.65
    const lng = (x / scale) * 360 - 180
    const n = Math.PI - (2 * Math.PI * y) / scale
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n))
    setCenter({ lat, lng })
  }, [center, zoom])

  const isSatellite = mapTypeId === 'satellite' || mapTypeId === 'hybrid'
  const tileLayer = isSatellite
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'
    : 'https://tile.openstreetmap.org'

  return (
    <div className="er-tile-map" style={{ height }} role="region" aria-label="Map showing your approximate location">
      <div className="er-tile-canvas">
        {tiles.map((tile) => (
          <img
            key={`${zoom}-${tile.x}-${tile.y}-${tileLayer}`}
            className="er-map-tile"
            src={isSatellite
              ? `${tileLayer}/${zoom}/${tile.urlY}/${tile.urlX}`
              : `${tileLayer}/${zoom}/${tile.urlX}/${tile.urlY}.png`}
            alt=""
            draggable={false}
            style={{ left: `calc(50% ${tile.left < 0 ? '-' : '+'} ${Math.abs(tile.left)}px)`, top: `calc(50% ${tile.top < 0 ? '-' : '+'} ${Math.abs(tile.top)}px)` }}
            onLoad={() => setTileError(false)}
            onError={() => setTileError(true)}
          />
        ))}
      </div>
      <div className="er-map-center-marker" aria-hidden="true"><span /></div>
      <div className="er-map-controls" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(19, z + 1))}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(3, z - 1))}>−</button>
        <div className="er-map-pan-row">
          <button type="button" aria-label="Pan left" onClick={() => nudge(-1, 0)}>←</button>
          <button type="button" aria-label="Pan up" onClick={() => nudge(0, -1)}>↑</button>
          <button type="button" aria-label="Pan down" onClick={() => nudge(0, 1)}>↓</button>
          <button type="button" aria-label="Pan right" onClick={() => nudge(1, 0)}>→</button>
        </div>
      </div>
      <div className="er-map-attribution">{tileError ? 'Map tiles may be blocked by your network.' : locationMessage} · Imagery © Esri</div>
    </div>
  )
}
