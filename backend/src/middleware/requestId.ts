import type { Request, Response, NextFunction } from 'express'
import crypto from 'node:crypto'

declare global {
  namespace Express {
    interface Request {
      id?: string
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const existing = req.header('x-request-id')
  const id = existing && existing.trim().length > 0 ? existing.trim() : crypto.randomUUID()
  req.id = id
  res.setHeader('X-Request-Id', id)
  next()
}
