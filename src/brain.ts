import Anthropic from '@anthropic-ai/sdk'
import type { Citizen } from './types.ts'

const client = new Anthropic()

export interface BrainOutput {
  thoughts: string
  dialogue: string
  memory: string
  relationshipDelta: number
  reason: string
}

export interface ConversationLine {
  speaker: string
  action?: string | null
  line: string
}

export interface Conversation {
  participants: [string, string]
  location: string
  lines: ConversationLine[]
}

export async function generateConversation(
  a: Citizen,
  b: Citizen,
  context: string
): Promise<Conversation> {
  const aScore = (() => {
    const k = Object.keys(a.relationships).find(k => k.toLowerCase() === b.name.toLowerCase())
    return k ? (a.relationships[k] ?? 0) : 0
  })()
  const bScore = (() => {
    const k = Object.keys(b.relationships).find(k => k.toLowerCase() === a.name.toLowerCase())
    return k ? (b.relationships[k] ?? 0) : 0
  })()

  const voiceGuide = `
Character voices (strictly enforce):
- EVE: sharp, toxic, deflects warmth with sarcasm — only softens at the very end of a line if at all
- Trencher: always has an angle, every line hints at a scheme or opportunity, reads people fast
- Alon: genuine warmth, no edge, believes in people, asks real questions
- Finn: skeptical, dry, cynical — but the cynicism is cracking; shows despite himself
- Tomas: steady, direct, no wasted words, pragmatic pride in craft`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Generate a short conversation between ${a.name} and ${b.name}.

${a.name}: ${a.occupation}. Traits: ${a.traits.join(', ')}. Goal: ${a.goal}.
${b.name}: ${b.occupation}. Traits: ${b.traits.join(', ')}. Goal: ${b.goal}.

${a.name}'s feeling toward ${b.name}: ${aScore.toFixed(2)} (−1 hostile → +1 warm)
${b.name}'s feeling toward ${a.name}: ${bScore.toFixed(2)} (−1 hostile → +1 warm)

Context: ${context}
${voiceGuide}

Rules:
- 2-4 lines total, alternating speakers, starting with ${a.name}
- Each line max 15 words
- Reflect the relationship scores — don't be warmer than the scores allow
- If Trencher is involved, their line must hint at an angle or scheme
- No stage directions, no asterisks, just the spoken words

Respond with ONLY valid JSON, no markdown:
{
  "lines": [
    {"speaker": "${a.name}", "action": "brief physical beat or null", "line": "spoken words only"},
    {"speaker": "${b.name}", "action": null, "line": "spoken words only"}
  ]
}`
    }]
  })

  const block = message.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('No text in conversation response')

  let raw = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) raw = match[0]!

  const parsed = JSON.parse(raw) as { lines: ConversationLine[] }

  return {
    participants: [a.name, b.name],
    location: a.location,
    lines: parsed.lines
  }
}

export async function think(actor: Citizen, target: Citizen): Promise<BrainOutput> {
  const key = Object.keys(actor.relationships).find(
    k => k.toLowerCase() === target.name.toLowerCase()
  )
  const score = key !== undefined ? (actor.relationships[key] ?? 0) : 0

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `You are roleplaying as ${actor.name}, a ${actor.occupation}.
Traits: ${actor.traits.join(', ')}
Goal: ${actor.goal}
Recent memories: ${actor.memories.slice(-3).join(' | ')}
Current feeling toward ${target.name}: ${score.toFixed(2)} (−1 hostile → +1 warm)

${target.name} is a ${target.occupation} with traits: ${target.traits.join(', ')}.
You just ran into ${target.name}. React as ${actor.name} would.

Respond with ONLY valid JSON, no markdown:
{
  "thoughts": "${actor.name}'s raw unfiltered internal reaction to seeing ${target.name} (1-2 sentences, honest and in character — not what they'd say out loud)",
  "dialogue": "what ${actor.name} actually says or does (1-2 sentences, in character)",
  "memory": "the memory ${actor.name} forms (1 sentence, first person past tense)",
  "relationshipDelta": <float between -0.3 and 0.3>,
  "reason": "2-6 words: the emotional truth behind this delta — e.g. 'saw through the charm' or 'genuine warmth landing' or 'guarded but intrigued'"
}`
    }]
  })

  const block = message.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('No text in brain response')

  let raw = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  // Extract just the JSON object if the model added trailing text
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) raw = match[0]!

  try {
    return JSON.parse(raw) as BrainOutput
  } catch {
    // Last resort: strip any text appended after the final closing quote+brace
    raw = raw.replace(/("[\w]+"\s*:\s*"[^"]*?")\s*[^,}\]"]+(?=[,}\]])/g, '$1')
    return JSON.parse(raw) as BrainOutput
  }
}
