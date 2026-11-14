import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } })
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Some fields are invalid.',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    })
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    })
  }
  logger.error({ err, path: req.path, requestId: req.id }, 'Unhandled error')
  const message = process.env.NODE_ENV === 'development' && err instanceof Error
    ? err.message
    : 'Something went wrong on the server.'
  return res.status(500).json({ error: { code: 'INTERNAL', message, requestId: req.id } })
}
