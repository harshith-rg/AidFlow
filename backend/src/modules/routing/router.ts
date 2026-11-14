import { env } from '../../config/env'
import { HaversineProvider } from './providers/haversine'
import { GraphProvider } from './providers/graph'
import { OsrmProvider } from './providers/osrm'
import { OrsProvider } from './providers/ors'
import type { RoutingProvider, RoutingProviderType } from './types'

export function getRoutingProvider(preferredProvider?: RoutingProviderType): RoutingProvider {
  const chosen = (preferredProvider || env.ROUTING_PROVIDER || 'haversine').toLowerCase()

  switch (chosen) {
    case 'graph':
      return new GraphProvider()
    case 'osrm':
      return new OsrmProvider()
    case 'ors':
      return new OrsProvider()
    case 'haversine':
    default:
      return new HaversineProvider()
  }
}
