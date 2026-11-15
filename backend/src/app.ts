import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { corsOrigins } from './config/env'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import { standardRateLimiter } from './middleware/rateLimit'
import { requestId } from './middleware/requestId'
import { healthRouter } from './modules/health/health.routes'
import { hospitalsRouter } from './modules/hospitals/hospitals.routes'
import { routingRouter } from './modules/routing/routing.routes'
import { authRouter } from './modules/auth/auth.routes'
import { emergenciesRouter } from './modules/emergencies/emergencies.routes'
import { dispatchRouter } from './modules/dispatch/dispatch.routes'
import { driverRouter } from './modules/driver/driver.routes'
import { ambulancesRouter } from './modules/ambulances/ambulances.routes'
import { telephonyRouter } from './modules/telephony/telephony.routes'
import { alertsRouter } from './modules/alerts/alerts.routes'
import { aicallRouter } from './modules/aicall/aicall.routes'
import { simulationRouter } from './modules/simulation/simulation.routes'
import { registerDispatchHook } from './modules/emergencies/emergencies.service'
import { startDispatch } from './modules/dispatch/engine'
import { registerTimeoutHandler } from './modules/dispatch/scheduler'
import { timeoutAttempt } from './modules/dispatch/service'
import { logger } from './utils/logger'

// Connect dispatch hook and timeout handler
registerDispatchHook(async (id) => {
  await startDispatch(id)
})
registerTimeoutHandler(timeoutAttempt)

export const app = express()
app.set('trust proxy', 1)

// Security headers
app.use(helmet())

// CORS & request tracing
app.use(cors({ origin: corsOrigins }))
app.use(requestId)
app.use(standardRateLimiter)
app.use(express.json({ limit: '100kb' }))

app.use((req, _res, next) => {
  logger.debug({ requestId: req.id, method: req.method, path: req.path }, 'request')
  next()
})

// Routes live at the root (no /api prefix) to match the frontend client: src/api/client.ts
app.use(healthRouter)
app.use(hospitalsRouter)
app.use(routingRouter)
app.use(authRouter)
app.use(emergenciesRouter)
app.use(dispatchRouter)
app.use(driverRouter)
app.use(ambulancesRouter)
app.use(telephonyRouter)
app.use(aicallRouter)
app.use(alertsRouter)
app.use(simulationRouter)

app.use(notFoundHandler)
app.use(errorHandler)
