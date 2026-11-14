// Every error response uses ONE shape, which the frontend (src/api/client.ts) already reads:
// { "error": { "code": "VALIDATION", "message": "...", "details": [...] } }
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Resource', details?: unknown) =>
  new AppError(404, 'NOT_FOUND', `${what} not found.`, details)
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION', message, details)
export const unauthorized = (message = 'Authentication required.', details?: unknown) =>
  new AppError(401, 'UNAUTHORIZED', message, details)
export const forbidden = (message = 'You do not have permission to do that.', details?: unknown) =>
  new AppError(403, 'FORBIDDEN', message, details)
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details)
