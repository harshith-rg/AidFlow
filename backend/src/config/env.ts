import dotenv from 'dotenv'
import path from 'node:path'
import { z } from 'zod'

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_TEST: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/aidflow_test'),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174'),
  DISPATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  DISPATCH_RADIUS_KM: z.coerce.number().int().positive().default(50),
  DISPATCH_RETRY_MS: z.coerce.number().int().positive().default(30000),
  DISPATCH_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  LOCATION_STALE_SECONDS: z.coerce.number().int().positive().default(120),
  HOSPITAL_STALE_HOURS: z.coerce.number().int().positive().default(24),
  ROUTING_PROVIDER: z.enum(['haversine', 'graph', 'osrm', 'ors', 'python']).default('graph'),
  PYTHON_ROUTING_URL: z.string().optional().default(''),
  ROUTING_SPEED_KMH: z.coerce.number().positive().default(35),
  OSRM_URL: z.string().optional().default(''),
  ORS_API_KEY: z.string().optional().default(''),
  SIMULATION_ENABLED: z.coerce.boolean().default(true),
  AI_EXTRACTOR: z.enum(['rules', 'llm']).default('rules'),
  TELEPHONY_PROVIDER: z.enum(['simulated'], {
    errorMap: () => ({ message: "Only 'simulated' TELEPHONY_PROVIDER is supported. Real telephony providers are disallowed." }),
  }).default('simulated'),
  HELPLINE_DEMO_NUMBER: z.string().default('1800-000-0000'),
  CALL_RING_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET is required and must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  SEED_DEMO_PASSWORD: z.string().min(8).default('ChangeMe123!'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  }
  console.error('Copy .env.example to .env and fill in the values.')
  process.exit(1)
}

export const env = parsed.data
export const corsOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim())
