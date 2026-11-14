import { env } from '../../config/env'
import { logger } from '../../utils/logger'

export interface TelephonyCallSession {
  id: string
  direction: 'inbound_caller' | 'outbound_driver'
  fromNumber: string
  toNumber: string
  callerName?: string | null
  status: 'ringing' | 'in_progress' | 'completed' | 'missed' | 'failed'
  emergencyId?: string | null
  ambulanceId?: string | null
  dispatchAttemptId?: string | null
  simulated: boolean
}

export interface TelephonyProvider {
  name: string
  initiateDriverCall(sessionId: string, ambulanceId: string, toNumber: string): Promise<void>
}

export class SimulatedTelephonyProvider implements TelephonyProvider {
  name = 'simulated'

  constructor() {
    if (env.TELEPHONY_PROVIDER && env.TELEPHONY_PROVIDER !== 'simulated') {
      throw new Error(
        `Safety Check: TELEPHONY_PROVIDER '${env.TELEPHONY_PROVIDER}' is not permitted. Only 'simulated' is supported to prevent accidental real telephony calls.`
      )
    }
  }

  async initiateDriverCall(sessionId: string, ambulanceId: string, toNumber: string): Promise<void> {
    logger.info(
      { sessionId, ambulanceId, toNumber, simulated: true },
      'Simulated telephony driver IVR call initiated'
    )
  }
}
