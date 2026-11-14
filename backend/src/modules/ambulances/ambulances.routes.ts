import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { updateAvailability, updateLocation, listAmbulances } from './ambulances.service'

export const ambulancesRouter = Router()

const availabilitySchema = z.object({
  status: z.enum(['available', 'offline']),
})

ambulancesRouter.patch(
  '/ambulances/:id/availability',
  requireAuth,
  requireRole('driver', 'admin'),
  validate({ body: availabilitySchema }),
  async (req, res, next) => {
    try {
      const result = await updateAvailability(
        req.params.id,
        req.body.status,
        { id: req.user!.id, role: req.user!.role }
      )
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timestamp: z.union([z.string(), z.number(), z.date()]).optional(),
  heading: z.number().min(0).max(360).optional().nullable(),
  speed: z.number().min(0).optional().nullable(),
  seq: z.number().int().optional(),
})

ambulancesRouter.patch(
  '/ambulances/:id/location',
  requireAuth,
  requireRole('driver', 'admin'),
  validate({ body: locationSchema }),
  async (req, res, next) => {
    try {
      const result = await updateLocation({
        ambulanceId: req.params.id,
        lat: req.body.lat,
        lng: req.body.lng,
        timestamp: req.body.timestamp,
        heading: req.body.heading,
        speed: req.body.speed,
        seq: req.body.seq,
      })
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

ambulancesRouter.get('/ambulances', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const list = await listAmbulances()
    res.json(list)
  } catch (err) {
    next(err)
  }
})
