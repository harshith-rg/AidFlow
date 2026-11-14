import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { startFollowCase, stopSimulation, checkSimulationEnabled } from './simulator'

export const simulationRouter = Router()

const followCaseSchema = z.object({
  caseId: z.string().min(1, 'Case ID is required'),
  intervalMs: z.number().int().min(200).max(10000).optional(),
})

simulationRouter.post(
  '/simulation/ambulances/:id/follow-case',
  requireAuth,
  requireRole('admin'),
  validate({ body: followCaseSchema }),
  async (req, res, next) => {
    try {
      checkSimulationEnabled()
      const result = await startFollowCase(req.params.id, req.body.caseId, req.body.intervalMs)
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

const stopSchema = z.object({
  ambulanceId: z.string().uuid().optional(),
})

simulationRouter.post(
  '/simulation/stop',
  requireAuth,
  requireRole('admin'),
  validate({ body: stopSchema }),
  async (req, res, next) => {
    try {
      checkSimulationEnabled()
      const result = stopSimulation(req.body.ambulanceId)
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)
