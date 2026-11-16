// Demo mode: accept any 10-digit number, including numbers starting with 0-5.
// Returns the 10 digits, or null when the input does not contain exactly 10 digits.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  return /^\d{10}$/.test(digits) ? digits : null
}

export function isValidName(raw: string): boolean {
  return raw.trim().length >= 2
}
