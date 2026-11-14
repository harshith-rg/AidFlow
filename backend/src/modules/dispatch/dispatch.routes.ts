import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { acceptAttempt, rejectAttempt } from './service'

export const dispatchRouter = Router()

const rejectSchema = z.object({
  reason: z.string().optional(),
})

dispatchRouter.post(
  '/dispatch/:attemptId/accept',
  requireAuth,
  requireRole('driver', 'admin'),
  async (req, res, next) => {
    try {
      const emergencyCase = await acceptAttempt(req.params.attemptId, req.user!.id)
      res.json(emergencyCase)
    } catch (err) {
      next(err)
    }
  }
)

dispatchRouter.post(
  '/dispatch/:attemptId/reject',
  requireAuth,
  requireRole('driver', 'admin'),
  validate({ body: rejectSchema }),
  async (req, res, next) => {
    try {
      await rejectAttempt(req.params.attemptId, req.user!.id, req.body?.reason)
      res.json({ message: 'Offer rejected successfully' })
    } catch (err) {
      next(err)
    }
  }
)
