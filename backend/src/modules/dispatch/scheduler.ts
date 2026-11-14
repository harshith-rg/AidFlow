import { pool } from '../../db/pool'
import { logger } from '../../utils/logger'

type TimeoutHandler = (attemptId: string) => Promise<void>

let onTimeoutCallback: TimeoutHandler | null = null
let sweeperInterval: NodeJS.Timeout | null = null
const activeTimers = new Map<string, NodeJS.Timeout>()

export function registerTimeoutHandler(handler: TimeoutHandler) {
  onTimeoutCallback = handler
}

/**
 * Registers an in-memory setTimeout for an offered attempt as an immediate trigger.
 */
export function scheduleAttemptTimeout(attemptId: string, expiresAt: Date) {
  if (activeTimers.has(attemptId)) {
    clearTimeout(activeTimers.get(attemptId)!)
    activeTimers.delete(attemptId)
  }

  const delayMs = Math.max(0, expiresAt.getTime() - Date.now())
  const timer = setTimeout(async () => {
    activeTimers.delete(attemptId)
    if (onTimeoutCallback) {
      try {
        await onTimeoutCallback(attemptId)
      } catch (err) {
        logger.error({ err, attemptId }, 'Failed to process scheduled attempt timeout')
      }
    }
  }, delayMs)

  timer.unref()
  activeTimers.set(attemptId, timer)
}

export function cancelAttemptTimeout(attemptId: string) {
  if (activeTimers.has(attemptId)) {
    clearTimeout(activeTimers.get(attemptId)!)
    activeTimers.delete(attemptId)
  }
}

/**
 * Background sweeper that polls every 2 seconds for expired pending dispatch attempts.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED to prevent concurrent duplicate sweep executions.
 */
export async function sweepExpiredAttempts(): Promise<number> {
  if (!onTimeoutCallback) return 0

  let sweptCount = 0
  const client = await pool.connect()
  try {
    const expiredRes = await client.query(
      `SELECT id FROM dispatch_attempts
       WHERE outcome = 'pending' AND expires_at <= now()
       FOR UPDATE SKIP LOCKED`
    )

    for (const row of expiredRes.rows) {
      cancelAttemptTimeout(row.id)
      try {
        await onTimeoutCallback(row.id)
        sweptCount++
      } catch (err) {
        logger.error({ err, attemptId: row.id }, 'Sweeper failed to timeout attempt')
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error running dispatch timeout sweeper')
  } finally {
    client.release()
  }

  return sweptCount
}

export function startScheduler(intervalMs = 2000) {
  if (sweeperInterval) return

  // Run immediate sweep upon startup
  sweepExpiredAttempts().catch((err) => logger.error({ err }, 'Initial sweeper run failed'))

  sweeperInterval = setInterval(() => {
    sweepExpiredAttempts().catch((err) => logger.error({ err }, 'Recurring sweeper run failed'))
  }, intervalMs)
  sweeperInterval.unref()

  logger.info({ intervalMs }, 'Dispatch timeout sweeper started')
}

export function stopScheduler() {
  if (sweeperInterval) {
    clearInterval(sweeperInterval)
    sweeperInterval = null
  }
  for (const timer of activeTimers.values()) {
    clearTimeout(timer)
  }
  activeTimers.clear()
}
