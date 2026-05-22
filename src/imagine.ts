import Anthropic from '@anthropic-ai/sdk'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Conversation } from './brain.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const anthropic = new Anthropic()

const STABILITY_ENDPOINT =
  'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image'

export async function generateTickImage(
  tickNumber: number,
  conversations: Conversation[]
): Promise<string | null> {
  if (!conversations.length) return null
  if (!process.env.STABILITY_API_KEY) return null

  const convo = conversations[0]!
  const [citizenA, citizenB] = convo.participants
  const location = convo.location
  const dialogue = convo.lines.map(l => `${l.speaker}: "${l.line}"`).join(' ')

  // Step 1: Claude writes the image prompt
  const promptResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `You are writing an image prompt for a dark indie illustrated game scene.

Location: ${location}
Citizens present: ${citizenA} and ${citizenB}
What just happened (dialogue): ${dialogue}

Write ONE image prompt using this exact structure:
"A dark painterly scene in [location]. [CitizenA] and [CitizenB] [what they are physically doing]. The mood is [mood]. Muted colors, indie illustration, slightly eerie."

Rules:
- Location: evocative and specific (e.g. "a candlelit inn at night" not just "Crossroads Inn")
- Describe physical action, not the dialogue content
- Mood captures the emotional undercurrent, not the surface action
- No UI, no speech bubbles, no text in image
- Under 60 words total
- Respond with ONLY the prompt, nothing else`
    }]
  })

  const promptBlock = promptResponse.content.find(b => b.type === 'text')
  if (!promptBlock || promptBlock.type !== 'text') return null

  const imagePrompt = promptBlock.text.trim() +
    ' Digital painting. Muted palette: dirty greens, dusty yellows, deep blacks. Pixel-art influenced painterly style. No text, no UI.'

  console.log(`\n  🎨 ${imagePrompt}\n`)

  // Step 2: Stability AI generates the image
  const res = await fetch(STABILITY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text_prompts: [{ text: imagePrompt, weight: 1 }],
      cfg_scale: 7,
      height: 1024,
      width: 1024,
      samples: 1,
      steps: 30,
    }),
  })

  if (!res.ok) {
    console.error(`  stability error: ${res.status} ${await res.text()}`)
    return null
  }

  const data = await res.json() as { artifacts: { base64: string; finishReason: string }[] }
  const artifact = data.artifacts[0]
  if (!artifact || artifact.finishReason !== 'SUCCESS') return null

  // Step 3: Decode and save
  const buffer = Buffer.from(artifact.base64, 'base64')

  const outDir = join(root, 'public', 'ticks')
  mkdirSync(outDir, { recursive: true })

  const outPath = join(outDir, `tick-${tickNumber}.png`)
  writeFileSync(outPath, buffer)

  return `public/ticks/tick-${tickNumber}.png`
}
