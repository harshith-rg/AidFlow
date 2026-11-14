import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import type { Role } from '../types/contract'
import { unauthorized, forbidden } from '../utils/errors'

export interface AuthUser {
  id: string
  email: string
  role: Role
  name?: string
  hospitalId?: string | null
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.header('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Authorization header with Bearer token is required.'))
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    return next(unauthorized('Bearer token is empty.'))
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser
    req.user = payload
    next()
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(unauthorized('Token has expired. Please log in again.'))
    }
    return next(unauthorized('Invalid authorization token.'))
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.header('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next()
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    return next()
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser
    req.user = payload
  } catch (_err) {
    // Ignore invalid/expired token in optionalAuth
  }
  next()
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(unauthorized('Authentication required.'))
    }
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`Role '${req.user.role}' is not authorized for this resource.`))
    }
    next()
  }
}
