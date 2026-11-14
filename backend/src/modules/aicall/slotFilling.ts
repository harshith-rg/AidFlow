export const SPECIAL_CONTEXT_OPTIONS = [
  'Road accident',
  'Heart attack / chest pain',
  'Breathing difficulty',
  'Stroke symptoms',
  'Severe bleeding',
  'Burns',
  'Fall / fracture',
  'Seizure',
  'Pregnancy-related emergency',
  'Poisoning',
  'Other',
] as const

export const REQUIRED_SLOT_ORDER = ['type', 'conscious', 'breathing', 'callerPhone', 'callerName', 'specialContext', 'location'] as const

export function missingSlots(slots: {
  type?: unknown
  conscious?: boolean
  breathing?: boolean
  lat?: number
  lng?: number
  callerName?: string
  callerPhone?: string
  specialContext?: string
}): string[] {
  return REQUIRED_SLOT_ORDER.filter((slot) => {
    if (slot === 'type') return !slots.type
    if (slot === 'conscious') return slots.conscious === undefined
    if (slot === 'breathing') return slots.breathing === undefined
    if (slot === 'callerPhone') return !/^\d{10}$/.test(slots.callerPhone ?? '')
    if (slot === 'callerName') return !slots.callerName?.trim()
    if (slot === 'specialContext') return !slots.specialContext
    return !Number.isFinite(slots.lat) || !Number.isFinite(slots.lng)
  })
}

export function nextQuestion(missing: string[]): string {
  if (missing.includes('type')) {
    return 'Please briefly tell me what happened.'
  }

  // Consciousness and breathing are intentionally collected together.
  if (missing.includes('conscious') || missing.includes('breathing')) {
    return 'Is the patient conscious and breathing?'
  }

  if (missing.includes('callerPhone')) {
    return 'What is the best 10-digit phone number to contact you on?'
  }

  if (missing.includes('callerName')) {
    return 'May I have the patient’s full name, please?'
  }

  if (missing.includes('specialContext')) {
    return 'Please select any of the options shown below for special context.'
  }

  if (missing.includes('location')) {
    return 'Detecting your location automatically. Please keep location access allowed on your device.'
  }

  return 'I have collected all the required emergency details.'
}
