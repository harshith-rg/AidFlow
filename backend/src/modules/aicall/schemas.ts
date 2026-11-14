import { z } from 'zod'

export const emergencySourceSchema = z.enum(['manual', 'ai_call'])
export const aiCallStartSchema = z.object({
  callerNumber: z.string().max(30).optional(),
  callerName: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  language: z.string().max(12).default('en-IN'),
}).refine((v) => (v.lat === undefined) === (v.lng === undefined), 'lat and lng must be supplied together')

export const aiCallTurnSchema = z.object({
  transcript: z.string().trim().max(2000).default(''),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  imageUrl: z.string().url().max(1000).optional(),
}).refine((v) => (v.lat === undefined) === (v.lng === undefined), 'lat and lng must be supplied together')
  .refine((v) => v.transcript.length > 0 || v.lat !== undefined, 'transcript or location is required')

export const aiCallFinalizeSchema = z.object({ allowPartial: z.boolean().default(false) })
