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

const CITIZEN_PROFILES: Record<string, string> = {
  Alon:     'Alon: tall, warm eyes, always carrying something, open hands, herbalist satchel over one shoulder',
  EVE:      'EVE: sharp posture, arms crossed or gesturing wildly, always looks like she knows more than she\'s saying',
  Finn:     'Finn: slightly hunched, skeptical eyes, keeps physical distance, hands in pockets or arms crossed',
  Tomas:    'Tomas: broad-shouldered, steady, slow deliberate movements, forge-worn calloused hands, never wastes words',
  Trencher: 'Trencher: young, restless energy, leans in too close, always has something in his hand or fidgeting',
}

const LOCATION_FLAVOUR: Record<string, string> = {
  'Crossroads Inn':   'a smoky low-beamed inn at the crossroads — firelight, mismatched tables, strangers in the shadows',
  'Blacksmith Forge': 'a forge at dusk — orange ember glow, iron smell, anvil shadows long across the floor',
  'Market Square':    'an empty market square at odd hours — abandoned stalls, wind-scattered debris, distant torchlight',
  'Town Square':      'a windswept town square at night — cobblestones slick with rain, torches guttering',
  'EVERYWHERE':       'a shifting street corner under gas lamps — figures passing without looking, wet pavement',
}

function locationFlavour(raw: string): string {
  for (const [key, val] of Object.entries(LOCATION_FLAVOUR)) {
    if (raw.toLowerCase().includes(key.toLowerCase())) return val
  }
  return `a desolate ${raw.toLowerCase()} at an uncertain hour`
}

function profiles(names: (string | undefined)[]): string {
  return names
    .filter((n): n is string => !!n && !!CITIZEN_PROFILES[n])
    .map(n => CITIZEN_PROFILES[n]!)
    .join('\n')
}

export async function generateTickComic(
  tickNumber: number,
  conversations: Conversation[]
): Promise<string | null> {
  if (!conversations.length) return null
  if (!process.env.STABILITY_API_KEY) return null

  const convo = conversations[0]!
  const [citizenA, citizenB] = convo.participants
  const location = locationFlavour(convo.location)
  const lines = convo.lines
  const dialogue = lines.map(l => `${l.speaker}: "${l.line}"`).join('\n')

  // Panel 2 gets the first exchange, Panel 3 gets the final beat
  const panel2Lines = lines.slice(0, 2).map(l => `${l.speaker}: "${l.line}"`).join(' / ')
  const lastLine = lines.at(-1)
  const panel3Line = lastLine ? `${lastLine.speaker}: "${lastLine.line}"` : 'silence'

  const citizenProfiles = profiles([citizenA, citizenB])

  // Step 1: Claude writes the 3-panel comic strip prompt
  const promptResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are writing an image generation prompt for a 3-panel horizontal comic strip.

TICK: ${tickNumber}
LOCATION: ${location}
CITIZENS: ${citizenA} and ${citizenB}
DIALOGUE THIS TICK:
${dialogue}

CITIZEN VISUAL PROFILES (always describe these physical details):
${citizenProfiles}

Write a single detailed image generation prompt for a 3-panel comic strip. Use present tense. Be specific about posture, lighting, shadow, distance between characters.

Format:
"Three-panel horizontal comic strip, thick black panel gutters between panels. Indie graphic novel art style — gritty ink linework, muted dirty greens and amber, charcoal blacks, heavy shadows, expressive worn faces. Like a zine crossed with noir. No clean superhero lines — rough and human.

PANEL 1 (left third) — establishing shot: [Describe the ${location} atmospherically. Show ${citizenA} and ${citizenB} entering or occupying the space. Caption box in upper-left corner reads: EVERWAKE / TICK ${tickNumber}. No speech yet — just environment and body language.]

PANEL 2 (center third) — the exchange: [Medium close-up on both characters. Specific postures, eye contact or lack of it. Speech bubbles visible in panel containing the words: ${panel2Lines}. Lighting detail — where is the shadow falling.]

PANEL 3 (right third) — the shift: [Reaction shot or tight close on one face after the words landed. The emotional residue. Speech bubble if there's a final line: ${panel3Line}. Bottom corner of panel shows small text: 'REL +/−'.]"

Rules:
- Under 280 words total
- Include character physical descriptions from the profiles above
- Be specific — exact postures, distances, shadow angles
- Respond with ONLY the prompt, no explanation`
    }]
  })

  const promptBlock = promptResponse.content.find(b => b.type === 'text')
  if (!promptBlock || promptBlock.type !== 'text') return null

  const imagePrompt = promptBlock.text.trim()
  console.log(`\n  📖 ${imagePrompt}\n`)

  // Step 2: Stability AI — 1536x640 is the widest supported SDXL landscape
  const res = await fetch(STABILITY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text_prompts: [
        { text: imagePrompt, weight: 1 },
        { text: 'single panel, photograph, 3D render, clean lines, modern, watermark, blurry, superhero comic', weight: -1 },
      ],
      cfg_scale: 9,
      height: 640,
      width: 1536,
      samples: 1,
      steps: 40,
    }),
  })

  if (!res.ok) {
    console.error(`  stability error: ${res.status} ${await res.text()}`)
    return null
  }

  const data = await res.json() as { artifacts: { base64: string; finishReason: string }[] }
  const artifact = data.artifacts[0]
  if (!artifact || artifact.finishReason !== 'SUCCESS') return null

  const buffer = Buffer.from(artifact.base64, 'base64')
  const outDir = join(root, 'public', 'ticks')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `comic-${tickNumber}.png`)
  writeFileSync(outPath, buffer)

  return `public/ticks/comic-${tickNumber}.png`
}
