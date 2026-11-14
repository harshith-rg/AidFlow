export type TriageLabel = 'critical' | 'high' | 'moderate' | 'low'
export interface TriageInput {
  type: string; conscious?: boolean; breathing?: boolean; patientCount?: number
  bleeding?: boolean; chestPain?: boolean; ageBand?: string; timeOfDay?: number
}
export interface TriageResult { label: TriageLabel; confidence: number; probabilities: Record<TriageLabel, number>; featureImportances?: Record<string, number>; source: 'ml-service' | 'rule-fallback' }

export function ruleTriage(input: TriageInput): TriageResult {
  let score = 0
  if (input.conscious === false) score += 5
  if (input.breathing === false) score += 6
  if (input.bleeding) score += 3
  if (input.chestPain || input.type === 'cardiac' || input.type === 'stroke' || input.type === 'fire') score += 4
  if (input.type === 'breathing') score += 4
  if (input.type === 'accident' || input.type === 'trauma' || input.type === 'poisoning') score += 3
  if ((input.patientCount ?? 1) > 1) score += 1
  const label: TriageLabel = score >= 8 ? 'critical' : score >= 5 ? 'high' : score >= 2 ? 'moderate' : 'low'
  const probabilities: Record<TriageLabel, number> = { critical: .05, high: .1, moderate: .65, low: .2 }
  probabilities[label] = .75
  const rest = (1 - .75) / 3
  for (const key of Object.keys(probabilities) as TriageLabel[]) if (key !== label) probabilities[key] = rest
  return { label, confidence: .75, probabilities, source: 'rule-fallback' }
}
export async function triage(input: TriageInput): Promise<TriageResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch(`${process.env.TRIAGE_SERVICE_URL ?? 'http://127.0.0.1:8100'}/triage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Triage service returned ${response.status}`)
    const data = await response.json() as Omit<TriageResult, 'source'>
    return { ...data, source: 'ml-service' }
  } catch {
    return ruleTriage(input)
  } finally { clearTimeout(timeout) }
}
