import { think } from './brain.ts'
import type { Citizen } from './types.ts'

export interface InteractResult {
  actor: string
  target: string
  thoughts: string
  dialogue: string
  memory: string
  reason: string
  before: number
  after: number
  delta: number
}

export async function interact(a: Citizen, b: Citizen): Promise<InteractResult> {
  const key = Object.keys(a.relationships).find(
    k => k.toLowerCase() === b.name.toLowerCase()
  ) ?? b.name

  const before = a.relationships[key] ?? 0
  const { thoughts, dialogue, memory, relationshipDelta, reason } = await think(a, b)

  const after = Math.max(-1, Math.min(1, before + relationshipDelta))
  a.relationships[key] = after
  a.memories.push(memory)

  return {
    actor: a.name, target: b.name,
    thoughts, dialogue, memory,
    reason: reason ?? 'something shifted',
    before, after, delta: after - before,
  }
}
