import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { pool, withTransaction } from '../../db/pool'
import { badRequest, notFound } from '../../utils/errors'
import { LLMExtractor, RuleExtractor, type ExtractedSlots } from './extractor'
import { env } from '../../config/env'
import { missingSlots, nextQuestion, SPECIAL_CONTEXT_OPTIONS } from './slotFilling'
import { triage } from './triage'
import { emitToRoom } from '../../realtime/events'
import { getEmergencyCase } from '../emergencies/emergencies.service'
import { startDispatch } from '../dispatch/engine'
import { hashTrackingToken, publicTrackingProjection } from './tracking'
import { aiCallFinalizeSchema, aiCallStartSchema, aiCallTurnSchema } from './schemas'
import { logger } from '../../utils/logger'

export const aicallRouter = Router()
const ruleExtractor = new RuleExtractor()
const llmExtractor = new LLMExtractor()
const sessions = new Map<string, number[]>()
const publicStrictRateLimiter = (req: any, res: any, next: any) => {
  const key = req.ip ?? 'unknown'
  const now = Date.now()
  const recent = (sessions.get(key) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= 12) return res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Too many demo call requests. Please wait a minute.' } })
  recent.push(now); sessions.set(key, recent); next()
}
const startSchema = aiCallStartSchema
const turnSchema = aiCallTurnSchema
const safeSlots = (s: any) => ({ type: s.type, description: s.description, patientCount: s.patientCount, conscious: s.conscious, breathing: s.breathing, lat: s.lat, lng: s.lng, locationText: s.locationText, callerName: s.callerName, callerPhone: s.callerPhone, specialContext: s.specialContext })

aicallRouter.post('/ai-calls/start', publicStrictRateLimiter, async (req, res, next) => {
  try {
    const input = startSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO call_sessions (direction, simulated, handled_by, caller_number, caller_name, language, slots)
       VALUES ('inbound_caller', TRUE, 'ai', $1, $2, $3, $4::jsonb) RETURNING id`,
      [input.callerNumber ?? null, input.callerName ?? null, input.language, JSON.stringify({ lat: input.lat, lng: input.lng, callerName: input.callerName, callerPhone: input.callerNumber })],
    )
    await pool.query("UPDATE call_sessions SET status='active' WHERE id=$1", [rows[0].id])
    emitToRoom('role:admin', 'call:incoming', { callSessionId: rows[0].id, direction: 'inbound_caller', fromNumber: input.callerNumber ?? 'Browser caller', toNumber: 'AidFlow AI', simulated: true, prompt: 'AI intake call started' })
    res.status(201).json({ sessionId: rows[0].id, greeting: 'AidFlow emergency helpline. I have your location from your device. Please tell me what happened.', language: input.language })
  } catch (err) { next(err) }
})

aicallRouter.post('/ai-calls/:id/turn', publicStrictRateLimiter, async (req, res, next) => {
  try {
    const input = turnSchema.parse(req.body)
    const { rows } = await pool.query('SELECT id, slots, status FROM call_sessions WHERE id = $1', [req.params.id])
    if (!rows[0] || rows[0].status !== 'active') throw notFound('Active AI call')
    const current = { ...(rows[0].slots ?? {}) } as ExtractedSlots & { lat?: number; lng?: number }
    let extracted: ExtractedSlots = {}
    const locationOnly = input.transcript.length === 0
    if (locationOnly) { /* silent GPS update from the device: no speech to parse */ }
    else if (env.AI_EXTRACTOR === 'llm') {
      try { extracted = await llmExtractor.extract(input.transcript, current) }
      catch { extracted = ruleExtractor.extract(input.transcript, current) }
    } else extracted = ruleExtractor.extract(input.transcript, current)
    const answer = input.transcript.trim()
    const normalizedAnswer = answer
      .toLowerCase()
      .replace(/[.!?,;:]+$/g, '')
      .trim()

    // Only interpret an answer against the next unanswered slot.
    // Checking whether a slot exists anywhere in missingBefore causes later
    // answers (e.g. a phone number) to be intercepted by specialContext.
    const missingBefore = missingSlots(current)
    const activeSlot = missingBefore[0]
    let clarificationReply: string | undefined

    if (!locationOnly && activeSlot) {
      // Consciousness + breathing are one combined question, while the two
      // clinical values remain separately stored for triage.
      if (activeSlot === 'conscious' || activeSlot === 'breathing') {
        const saysYes = /^(yes|yeah|yep|y|both|correct)$/i.test(normalizedAnswer)
        const saysNo = /^(no|nope|n)$/i.test(normalizedAnswer)

        const saysUnconscious = /unconscious|unresponsive|not conscious/i.test(normalizedAnswer)
        const saysConscious = /\b(conscious|awake)\b/i.test(normalizedAnswer)
        const saysNotBreathing = /not breathing|stopped breathing|no breathing/i.test(normalizedAnswer)
        const saysBreathing = /\b(breathing|breathes)\b/i.test(normalizedAnswer) && !saysNotBreathing

        if (saysYes) {
          extracted.conscious = true
          extracted.breathing = true
        } else if (saysNo) {
          // "No" to a compound question is ambiguous: do not guess.
          delete extracted.conscious
          delete extracted.breathing
          clarificationReply =
            'Please clarify: is the patient unconscious but breathing, conscious but not breathing, or both unconscious and not breathing?'
        } else if (saysUnconscious && saysNotBreathing) {
          extracted.conscious = false
          extracted.breathing = false
        } else if (saysUnconscious && saysBreathing) {
          extracted.conscious = false
          extracted.breathing = true
        } else if (saysConscious && saysNotBreathing) {
          extracted.conscious = true
          extracted.breathing = false
        } else if (saysConscious && saysBreathing) {
          extracted.conscious = true
          extracted.breathing = true
        } else {
          delete extracted.conscious
          delete extracted.breathing
          clarificationReply =
            'Please clarify whether the patient is conscious and breathing normally, unconscious but breathing, conscious but not breathing, or neither conscious nor breathing.'
        }
      }

      // Emergency type is handled by the existing RuleExtractor / LLMExtractor.
      else if (activeSlot === 'type') {
        // Preserve the extractor's result for the emergency description.
      }

      // Patient count, if the extractor/flow requests it, is parsed here.
      else if (activeSlot === 'patientCount') {
        const countAnswer = answer.match(/^(one|two|three|four|five|\d{1,2})(?:\s+(?:people|patients|persons|victims|person|patient))?$/i)
        if (countAnswer) {
          const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 }
          const value = countAnswer[1].toLowerCase()
          extracted.patientCount = words[value] ?? Number(value)
        }
      }

      // Caller phone number.
      else if (activeSlot === 'callerPhone') {
        const digits = answer.replace(/\D/g, '')
        if (digits.length === 10) {
          extracted.callerPhone = digits
        } else {
          const digitWords: Record<string, string> = {
            zero: '0', oh: '0', one: '1', two: '2', three: '3',
            four: '4', five: '5', six: '6', seven: '7',
            eight: '8', nine: '9',
          }
          const spokenWords = answer.toLowerCase().match(
            /\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g,
          ) ?? []
          const spokenDigits = spokenWords.map((word) => digitWords[word]).join('')
          if (spokenDigits.length === 10) extracted.callerPhone = spokenDigits
        }
      }

      // Patient name.
      else if (activeSlot === 'callerName') {
        const cleanedName = answer
          .replace(/^(?:my name is|i am|i'm|this is)\s+/i, '')
          .trim()
        if (cleanedName.length >= 2 && cleanedName.length <= 100 && !/\d/.test(cleanedName)) {
          extracted.callerName = cleanedName
        }
      }

      // Special context: only parse a numbered choice when this is the
      // current question, never merely because this field is still missing.
      else if (activeSlot === 'specialContext') {
        const choiceText = normalizedAnswer
          .replace(/^(?:option|number|press)\s+/i, '')
          .trim()
        const numberWords: Record<string, string> = {
          zero: '0', none: '0', one: '1', two: '2', three: '3',
          four: '4', five: '5', six: '6', seven: '7',
          eight: '8', nine: '9', ten: '10', eleven: '11',
        }
        const selected = numberWords[choiceText] ?? choiceText

        if (selected === '0' || choiceText === 'no special context') {
          extracted.specialContext = 'None'
        } else if (/^\d{1,2}$/.test(selected)) {
          const index = Number(selected)
          if (index >= 1 && index <= SPECIAL_CONTEXT_OPTIONS.length) {
            extracted.specialContext = SPECIAL_CONTEXT_OPTIONS[index - 1]
          }
        } else {
          const contextAliases: Record<string, string> = {
            'burns / fire': 'Burns',
            'pregnancy emergency': 'Pregnancy-related emergency',
            'other emergency': 'Other',
          }
          const normalizedContext = contextAliases[choiceText] ?? choiceText
          const matchedContext = SPECIAL_CONTEXT_OPTIONS.find(
            (option) => option.toLowerCase() === normalizedContext,
          )
          if (matchedContext) extracted.specialContext = matchedContext
        }
      }
    }
    if (input.lat !== undefined && input.lng !== undefined) {
      ;(extracted as ExtractedSlots & { lat?: number; lng?: number }).lat = input.lat
      ;(extracted as ExtractedSlots & { lat?: number; lng?: number }).lng = input.lng
    }
    // Coordinates supplied at call start are retained; transcript is treated only as caller data.
    const merged = { ...current, ...extracted } as ExtractedSlots & { lat?: number; lng?: number }
    const missing = missingSlots(merged)
    const reply = clarificationReply ?? nextQuestion(missing)
    const done = missing.length === 0
    await pool.query('UPDATE call_sessions SET slots = $2::jsonb, last_transcript = $3, updated_at = now() WHERE id = $1',
      [req.params.id, JSON.stringify(merged), input.transcript || current.description || ''])
    if (!locationOnly) {
      emitToRoom('role:admin', 'call:transcript', { callSessionId: req.params.id, speaker: 'caller', text: input.transcript, slots: safeSlots(merged) })
      emitToRoom('role:admin', 'call:transcript', { callSessionId: req.params.id, speaker: 'ai', text: reply, slots: safeSlots(merged) })
    }
    res.json({ agentReply: reply, slots: safeSlots(merged), missingSlots: missing, done })
  } catch (err) { next(err) }
})

aicallRouter.post('/ai-calls/:id/finalize', publicStrictRateLimiter, async (req, res, next) => {
  try {
    aiCallFinalizeSchema.parse(req.body ?? {})
    const { rows } = await pool.query('SELECT * FROM call_sessions WHERE id = $1', [req.params.id])
    const call = rows[0]
    if (!call || call.status === 'failed') throw notFound('AI call')
    if (call.emergency_id) {
      const existing = await pool.query('SELECT case_code, severity, eta_minutes FROM emergencies WHERE id = $1', [call.emergency_id])
      return res.json({ caseCode: existing.rows[0].case_code, trackingToken: '', etaMinutes: existing.rows[0].eta_minutes, severity: existing.rows[0].severity, agentClosingMessage: `Your demo case ${existing.rows[0].case_code} has already been registered.` })
    }
    const s = call.slots as ExtractedSlots & { lat?: number; lng?: number }
    const missing = missingSlots(s)
    if (missing.length) throw badRequest(`Cannot finalize yet. Missing: ${missing.join(', ')}.`)
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) throw badRequest('A GPS location is required before finalizing.')
    const reporterName = s.callerName?.trim() ?? ''
    const reporterPhone = s.callerPhone ?? ''
    if (!reporterName || !/^\d{10}$/.test(reporterPhone)) throw badRequest('A caller name and valid 10-digit phone number are required.')
    const emergencyType = s.type ?? 'other'
    const duplicate = await pool.query(
      `SELECT id, case_code, severity, eta_minutes FROM emergencies
       WHERE reporter_phone=$1 AND created_at >= now() - interval '5 minutes'
         AND status <> 'cancelled'
         AND ((pickup_lat-$2)^2 + (pickup_lng-$3)^2) < 0.0001
       ORDER BY created_at DESC LIMIT 1`,
      [reporterPhone, s.lat, s.lng],
    )
    if (duplicate.rows[0]) {
      const existing = duplicate.rows[0]
      await pool.query(`UPDATE call_sessions SET status='completed', emergency_id=$2, caller_number=$3, caller_name=$4, updated_at=now() WHERE id=$1`, [req.params.id, existing.id, reporterPhone, reporterName])
      return res.json({
        caseCode: existing.case_code, trackingToken: '', etaMinutes: existing.eta_minutes, severity: existing.severity,
        agentClosingMessage: `A recent report from this number and location is already registered as ${existing.case_code}. Help is already being coordinated in this demo.`,
      })
    }
    const triageResult = await triage({ type: emergencyType, conscious: s.conscious, breathing: s.breathing, patientCount: s.patientCount ?? 1 })
    const severity = triageResult.label === 'critical' ? 'critical' : triageResult.label === 'high' ? 'high' : 'medium'
    const alertMessage = `NEW EMERGENCY (${triageResult.label.toUpperCase()}): ${emergencyType}, ${s.locationText ?? 'GPS location'}, reported via AI call`
    const token = randomBytes(32).toString('base64url')
    const tokenHash = hashTrackingToken(token)
    const created = await withTransaction(async (client) => {
      const nearest = await client.query(
        `SELECT id, name FROM hospitals WHERE is_operational=TRUE ORDER BY ((lat-$1)^2 + (lng-$2)^2) ASC LIMIT 1`,
        [s.lat, s.lng],
      )
      const hospital = nearest.rows[0]
      const emergency = await client.query(
        `INSERT INTO emergencies (type, severity, source, call_session_id, triage_label, triage_confidence, tracking_token_hash, reporter_name, reporter_phone, description, pickup_lat, pickup_lng, pickup_address, hospital_id, hospital_reason, is_demo)
         VALUES ($1,$2,'ai_call',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE) RETURNING id, case_code, eta_minutes`,
        [emergencyType, severity, req.params.id, triageResult.label, triageResult.confidence, tokenHash, reporterName, reporterPhone,
          `${s.description ?? ''} | patients=${s.patientCount ?? 1}; conscious=${s.conscious}; breathing=${s.breathing}; special context=${s.specialContext ?? 'Not specified'}`,
          s.lat, s.lng, s.locationText ?? `GPS ${Number(s.lat).toFixed(5)}, ${Number(s.lng).toFixed(5)}`, hospital?.id ?? null, hospital ? 'Nearest operational hospital by approximate coordinate distance.' : null],
      )
      const e = emergency.rows[0]
      await client.query(
        `INSERT INTO emergency_status_history (emergency_id, from_status, to_status, note)
         VALUES ($1, NULL, 'waiting', 'Created via simulated AI call')`,
        [e.id],
      )
      const alert = await client.query(`INSERT INTO alerts (type, message, emergency_id, target_role) VALUES ('emergency_reported',$1,$2,'admin') RETURNING id`, [alertMessage, e.id])
      await client.query(`UPDATE call_sessions SET status='completed', emergency_id=$2, caller_number=$3, caller_name=$4, updated_at=now() WHERE id=$1`, [req.params.id, e.id, reporterPhone, reporterName])
      return { emergency: e, alertId: alert.rows[0].id, hospital }
    })
    // The database transaction above is the source of truth. A failure while
    // building the optional rich socket payload must not turn a successfully
    // registered emergency into a 500 response (which invites duplicate reports).
    try {
      const registeredCase = await getEmergencyCase(created.emergency.id)
      emitToRoom('role:admin', 'case:created', { caseId: created.emergency.case_code, emergency: registeredCase })
    } catch (projectionError) {
      logger.error({ err: projectionError, emergencyId: created.emergency.id }, 'AI-call case projection failed after registration')
      emitToRoom('role:admin', 'case:created', { caseId: created.emergency.case_code })
    }
    void startDispatch(created.emergency.id).catch((dispatchError) => logger.error({ err: dispatchError, emergencyId: created.emergency.id }, 'AI-call dispatch start failed'))
    emitToRoom('role:admin', 'alert:new', { id: created.alertId, type: 'emergency_reported', message: alertMessage, emergencyId: created.emergency.id, targetRole: 'admin', createdAt: new Date().toISOString() })
    if (created.hospital) emitToRoom(`hospital:${created.hospital.id}`, 'hospital:incoming', { hospitalId: created.hospital.id, caseId: created.emergency.id, ambulanceId: '', etaMinutes: created.emergency.eta_minutes ?? 0, emergencyType, severity })
    res.status(201).json({
      caseCode: created.emergency.case_code, trackingToken: token, etaMinutes: created.emergency.eta_minutes,
      severity, agentClosingMessage: `Help is on the way in this demo workflow. Your case ID is ${created.emergency.case_code}. Open your tracking page for status updates.`,
    })
  } catch (err) { next(err) }
})

aicallRouter.post('/ai-calls/:id/abandon', publicStrictRateLimiter, async (req, res, next) => {
  try {
    await pool.query(`UPDATE call_sessions SET status='failed', updated_at=now() WHERE id=$1 AND status='active'`, [req.params.id])
    res.status(204).end()
  } catch (err) { next(err) }
})

aicallRouter.get('/track/:token', publicStrictRateLimiter, async (req, res, next) => {
  try {
    const hash = hashTrackingToken(req.params.token)
    const { rows } = await pool.query(
      `SELECT e.id, e.case_code, e.status, e.eta_minutes, e.pickup_address, e.reporter_name, e.reporter_phone,
        a.label AS ambulance_label, a.vehicle_number, u.name AS driver_name,
        h.name AS hospital_name, e.pickup_lat, e.pickup_lng, h.lat AS hospital_lat, h.lng AS hospital_lng, a.lat AS ambulance_lat, a.lng AS ambulance_lng,
        COALESCE((SELECT json_agg(json_build_object('status', sh.to_status, 'at', sh.changed_at) ORDER BY sh.changed_at) FROM emergency_status_history sh WHERE sh.emergency_id=e.id), '[]'::json) AS history
       FROM emergencies e LEFT JOIN ambulances a ON a.id=e.assigned_ambulance_id
       LEFT JOIN users u ON u.id=a.driver_id LEFT JOIN hospitals h ON h.id=e.hospital_id
       WHERE e.tracking_token_hash=$1`, [hash],
    )
    if (!rows[0]) throw notFound('Tracking token')
    res.json(publicTrackingProjection(rows[0]))
  } catch (err) { next(err) }
})
