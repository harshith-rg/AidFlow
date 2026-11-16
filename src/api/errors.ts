export type ApiErrorCode =
  | 'NETWORK'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'UNAUTHORIZED'
  | 'SERVER'

// Every API failure becomes this, so screens can show a clear message + Retry.
export class ApiException extends Error {
  code: ApiErrorCode | string
  constructor(code: ApiErrorCode | string, message: string) {
    super(message)
    this.name = 'ApiException'
    this.code = code
  }
}
