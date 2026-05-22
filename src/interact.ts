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

async function thinkWithRetry(a: Citizen, b: Citizen, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await think(a, b)
    } catch (err: unknown) {
      const isOverloaded = (err as { status?: number })?.status === 529
      const isBadJson = err instanceof SyntaxError
      if ((isOverloaded || isBadJson) && i < attempts - 1) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('think: all retries exhausted')
}

export async function interact(a: Citizen, b: Citizen): Promise<InteractResult> {
  const key = Object.keys(a.relationships).find(
    k => k.toLowerCase() === b.name.toLowerCase()
  ) ?? b.name

  const before = a.relationships[key] ?? 0
  const { thoughts, dialogue, memory, relationshipDelta, reason } = await thinkWithRetry(a, b)

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
