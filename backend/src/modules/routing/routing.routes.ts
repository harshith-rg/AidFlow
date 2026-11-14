import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate'
import { getRoutingProvider } from './router'
import type { LatLng } from './types'

export const routingRouter = Router()

const routeSchema = z.object({
  from: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  to: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
})

// Road-network route from assigned ambulance GPS to the reported emergency.
// The graph is the project's Bengaluru demo road network; ETA is an estimate, not live traffic.
routingRouter.post('/routing/route', validate({ body: routeSchema }), async (req, res, next) => {
  try {
    const from = req.body.from as LatLng
    const to = req.body.to as LatLng
    const result = await getRoutingProvider().route(from, to)
    res.json(result)
  } catch (err) {
    next(err)
  }
})
