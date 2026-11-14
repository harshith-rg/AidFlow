import type { Request, Response, NextFunction } from 'express'
import type { ZodTypeAny, ZodError } from 'zod'

interface ValidationSchemas {
  body?: ZodTypeAny
  query?: ZodTypeAny
  params?: ZodTypeAny
}

/**
 * Middleware helper that validates incoming request body, query, and params using Zod.
 * Any validation failure is passed to errorHandler which formats it into the unified error shape:
 * { "error": { "code": "VALIDATION", "message": "Some fields are invalid.", "details": [...] } }
 */
export function validate(schemas: ValidationSchemas) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body)
      }
      if (schemas.query) {
        req.query = (await schemas.query.parseAsync(req.query)) as Request['query']
      }
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as Request['params']
      }
      next()
    } catch (err) {
      next(err as ZodError)
    }
  }
}
