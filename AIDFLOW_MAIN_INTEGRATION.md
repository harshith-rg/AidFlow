# AidFlow-main features integrated into AidFlow_dispatch_original_restored

## What changed

- The dispatch/tracking page now scrolls to the top when opened, including the public tracking route reached by the **Open live tracking** button.
- The assigned ambulance's latest saved GPS coordinates are included in the emergency case response.
- A new `POST /routing/route` endpoint returns a road-graph route from the assigned ambulance to the reported emergency.
- The Bengaluru demo road graph now runs Dijkstra's shortest-path algorithm. The route geometry is drawn on the satellite map and the distance / estimated arrival time are shown above the map.
- If either endpoint is more than 8 km from the Bengaluru demo graph, the system deliberately falls back to a straight-line estimate rather than snapping the ambulance to an unrelated road. This fallback is labelled and is not a road-navigation route.
- Hospital recommendation was already present in this project's backend (`backend/src/modules/routing/recommend.ts`) and is called during dispatch acceptance (`backend/src/modules/dispatch/service.ts`). The selected hospital and its recommendation reason are surfaced in the dispatch page; nearby hospitals remain listed as alternatives.

## Important accuracy notes

This is an academic demo implementation. The included Bengaluru road graph is a small synthetic road network, not a complete production road map. Dijkstra optimizes distance across the edges present in that graph. The ETA uses the configured demo average speed and does not include live traffic, closures, or real emergency-vehicle routing restrictions. The map shows the latest GPS fix received by the backend; it is only live if the ambulance location simulator/driver client continues sending updates.

For production-quality Uber/Swiggy-style navigation, replace the small demo graph with a complete road network or a routing service such as OSRM / OpenRouteService and add a traffic-aware ETA provider.
