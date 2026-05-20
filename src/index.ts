import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { interact, type InteractResult } from './interact.ts'
import { updateCitizenBalances, trencherTrade } from './economy.ts'
import { generateConversation, type Conversation } from './brain.ts'
import type { Citizen } from './types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const citizensDir = join(root, 'citizens')
const worldDir = join(root, 'world')
const tickFile = join(worldDir, 'tick.json')

function loadCitizen(filename: string): Citizen {
  return JSON.parse(readFileSync(join(citizensDir, filename), 'utf-8')) as Citizen
}

function saveCitizen(citizen: Citizen) {
  writeFileSync(join(citizensDir, `${citizen.name.toLowerCase()}.json`), JSON.stringify(citizen, null, 2))
}

function loadTick(): number {
  if (existsSync(tickFile)) {
    return (JSON.parse(readFileSync(tickFile, 'utf-8')) as { tick: number }).tick
  }
  return 0
}

function saveTick(n: number, conversations: Conversation[] = []) {
  writeFileSync(tickFile, JSON.stringify({ tick: n, conversations }, null, 2))
}

function gcEmit(type: string, message: string, payload?: object) {
  try {
    const payloadStr = payload ? `--payload '${JSON.stringify(payload)}'` : ''
    execSync(`gc event emit ${type} --actor everwake --message "${message}" ${payloadStr}`, {
      cwd: root, stdio: 'pipe'
    })
  } catch { /* best-effort */ }
}

function gcMail(subject: string, body: string) {
  try {
    execSync(`gc mail send mayor/ --from everwake --notify -s "${subject}" -m "${body.replace(/"/g, "'")}"`, {
      cwd: root, stdio: 'pipe'
    })
  } catch { /* best-effort */ }
}

// ─── CINEMATIC ENGINE ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function p(line = '', delay = 40) {
  console.log(line)
  await sleep(delay)
}

const SEP = chalk.dim('─────────────────────────────────')

function timeOfDay(): string {
  const h = new Date().getHours()
  if (h >= 6 && h < 12) return 'MORNING'
  if (h >= 12 && h < 17) return 'AFTERNOON'
  if (h >= 17 && h < 21) return 'EVENING'
  return 'NIGHT'
}

function socialStanding(name: string, citizens: Citizen[]): number {
  const scores: number[] = []
  for (const c of citizens) {
    if (c.name === name) continue
    const key = Object.keys(c.relationships).find(k => k.toLowerCase() === name.toLowerCase())
    if (key !== undefined && c.relationships[key] !== undefined) scores.push(c.relationships[key]!)
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
}

function standingBar(score: number): string {
  const filled = Math.round((score + 1) / 2 * 10)
  const bar = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, 10 - filled))
  if (score > 0.5) return chalk.green(bar)
  if (score < -0.2) return chalk.red(bar)
  return chalk.yellow(bar)
}

function citizenStatus(c: Citizen, results: InteractResult[]): string {
  const incoming = results.filter(r => r.target === c.name)
  const avgDelta = incoming.length
    ? incoming.reduce((s, r) => s + r.delta, 0) / incoming.length
    : 0
  const avg = Object.values(c.relationships).reduce((s, v) => s + v, 0) /
    Math.max(1, Object.keys(c.relationships).length)

  const map: Record<string, () => string> = {
    EVE:      () => avgDelta > 0.03 ? "softening. won't admit it." : avg > 0.8 ? 'electric. watching everyone.' : 'volatile. pushing.',
    Tomas:    () => avg > 0.85 ? 'steady. always steady.' : 'grinding toward more.',
    Finn:     () => avgDelta > 0.03 ? 'something is cracking.' : avg > 0.85 ? 'guarded. but warming.' : 'cynical. not wrong though.',
    Alon:     () => avg > 0.9 ? 'most trusted in Everwake.' : 'open. always open.',
    Trencher: () => avg < 0.6 ? 'new. pushing too hard.' : avg > 0.85 ? 'gaining ground. fast.' : 'working every angle.',
  }
  return (map[c.name] ?? (() => avg > 0.5 ? 'steady.' : 'restless.'))()
}

function tickSummary(tick: number, results: InteractResult[]): string {
  const significant = [...results]
    .filter(r => Math.abs(r.delta) > 0.05)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const top = significant[0]

  if (!top) return `Tick ${tick} — nothing moved. The town held its breath.`
  if (top.delta >= 0.1) return `${top.actor} and ${top.target} got closer this tick. Something between them is shifting.`
  if (top.delta <= -0.1) return `${top.actor} pulled back from ${top.target}. A distance is opening.`
  if (significant.length >= 3) return `Tick ${tick} — small movements everywhere. The town is restless tonight.`
  return `${top.actor} noticed ${top.target} differently this tick. It's not much, but it's something.`
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

const tick = loadTick() + 1
const citizens = readdirSync(citizensDir)
  .filter(f => f.endsWith('.json'))
  .map(f => loadCitizen(f))

// ─── RUN INTERACTIONS (silent) ───────────────────────────────────────────────

const total = citizens.length * (citizens.length - 1)
let done = 0

process.stdout.write(chalk.dim(`  processing tick ${tick}...\r`))

const results: InteractResult[] = []
for (let i = 0; i < citizens.length; i++) {
  for (let j = 0; j < citizens.length; j++) {
    if (i !== j) {
      const result = await interact(citizens[i]!, citizens[j]!)
      results.push(result)
      done++
      process.stdout.write(chalk.dim(`  processing ${done}/${total} interactions...\r`))
    }
  }
}

process.stdout.write(' '.repeat(50) + '\r')

// ─── GENERATE CONVERSATIONS ──────────────────────────────────────────────────

const seen = new Set<string>()
const conversationPairs: Array<{ a: Citizen; b: Citizen; context: string }> = []

const rankedResults = [...results]
  .filter(r => Math.abs(r.delta) > 0.05)
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

for (const r of rankedResults) {
  if (conversationPairs.length >= 2) break
  const pairKey = [r.actor, r.target].sort().join('|')
  if (seen.has(pairKey)) continue
  seen.add(pairKey)
  const a = citizens.find(c => c.name === r.actor)!
  const b = citizens.find(c => c.name === r.target)!
  const sameLocation = a.location === b.location
  const context = r.delta > 0
    ? `Their relationship just warmed (${r.before.toFixed(2)} → ${r.after.toFixed(2)})${sameLocation ? `, both at ${a.location}` : ''}.`
    : `Their relationship just cooled (${r.before.toFixed(2)} → ${r.after.toFixed(2)})${sameLocation ? `, both at ${a.location}` : ''}.`
  conversationPairs.push({ a, b, context })
}

if (conversationPairs.length === 0) {
  for (let i = 0; i < citizens.length && conversationPairs.length < 1; i++) {
    for (let j = i + 1; j < citizens.length; j++) {
      if (citizens[i]!.location === citizens[j]!.location) {
        const pairKey = [citizens[i]!.name, citizens[j]!.name].sort().join('|')
        if (!seen.has(pairKey)) {
          seen.add(pairKey)
          conversationPairs.push({
            a: citizens[i]!, b: citizens[j]!,
            context: `Both are at ${citizens[i]!.location}.`
          })
          break
        }
      }
    }
  }
}

const conversations: Conversation[] = []
for (const { a, b, context } of conversationPairs) {
  try {
    conversations.push(await generateConversation(a, b, context))
  } catch { /* best-effort */ }
}

// ─── ECONOMY (silent) ────────────────────────────────────────────────────────

await updateCitizenBalances(citizens)

const trencher = citizens.find(c => c.name === 'Trencher')
let tradeNote = ''
if (trencher) {
  const trade = await trencherTrade(trencher, citizens)
  if (trade.fired) {
    tradeNote = `Trencher moved ${trade.amount} $WAKE → ${trade.to}  (${trade.reason})`
    gcEmit('everwake.trade', `Trencher sent ${trade.amount} $WAKE to ${trade.to}`, {
      from: trade.from, to: trade.to, amount: trade.amount
    })
  }
}

// ─── SAVE STATE ──────────────────────────────────────────────────────────────

citizens.forEach(saveCitizen)
saveTick(tick, conversations)

// ─── GC EVENTS ───────────────────────────────────────────────────────────────

const notableEvents: string[] = []
for (const r of results) {
  if (r.delta <= -0.15) {
    const msg = `${r.actor} and ${r.target} had a hostile encounter (${r.before.toFixed(2)} → ${r.after.toFixed(2)})`
    gcEmit('everwake.conflict', msg, { actor: r.actor, target: r.target, before: r.before, after: r.after })
    notableEvents.push(msg)
  } else if (r.delta >= 0.15) {
    const msg = `${r.actor} warmed to ${r.target} (${r.before.toFixed(2)} → ${r.after.toFixed(2)})`
    gcEmit('everwake.bond', msg, { actor: r.actor, target: r.target, before: r.before, after: r.after })
    notableEvents.push(msg)
  }
}
gcEmit('everwake.tick', `Tick ${tick} complete — ${results.length} interactions`, {
  tick, interactions: results.length,
  conflicts: results.filter(r => r.delta <= -0.15).length,
  bonds: results.filter(r => r.delta >= 0.15).length,
})

// ─── MAYOR MAIL ──────────────────────────────────────────────────────────────

const worstPair = [...results].sort((a, b) => a.after - b.after)[0]!
const bestPair  = [...results].sort((a, b) => b.after - a.after)[0]!
const mailBody = [
  `EVERWAKE — TICK ${tick} REPORT`,
  `${results.length} interactions processed.`,
  '',
  notableEvents.length > 0
    ? `NOTABLE:\n${notableEvents.map(e => `  • ${e}`).join('\n')}`
    : 'No major relationship shifts.',
  '',
  `COLDEST PAIR: ${worstPair.actor} → ${worstPair.target} at ${worstPair.after.toFixed(2)}`,
  `WARMEST PAIR: ${bestPair.actor} → ${bestPair.target} at ${bestPair.after.toFixed(2)}`,
  '',
  tradeNote ? `TRADES:\n  ${tradeNote}` : 'No trades this tick.',
  '',
  'State saved.',
].join('\n')
gcMail(`Tick ${tick} complete`, mailBody)

// ─── CINEMATIC OUTPUT ─────────────────────────────────────────────────────────

const tod = timeOfDay()

await p()
await p(SEP, 20)
await p(chalk.bold.white(`EVERWAKE — TICK ${tick}`), 60)
await p(SEP, 20)

// Conversations
for (const convo of conversations) {
  const loc = convo.location.toUpperCase()
  await p()
  await p(chalk.yellow(`📍 ${loc} — ${tod}`), 60)
  await p()

  const [nameA, nameB] = convo.participants
  for (const line of convo.lines) {
    const isA = line.speaker === nameA
    const nameColor = isA ? chalk.cyan : chalk.magenta
    await p(`  ${nameColor(chalk.bold(line.speaker.toUpperCase()))}`, 80)
    if (line.action) {
      await p(`  ${chalk.dim.italic(`(${line.action})`)}`, 30)
    }
    await p(`  ${chalk.white(`"${line.line}"`)}`, 60)
    await p()
  }
}

// Relationship shifts
const shifts = results
  .filter(r => Math.abs(r.delta) > 0.02)
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

if (shifts.length > 0) {
  await p(SEP, 20)
  await p(chalk.bold.white('RELATIONSHIP SHIFTS'), 60)
  await p(SEP, 20)
  await p()

  for (const r of shifts) {
    const sign = r.delta >= 0 ? '+' : ''
    const arrow = r.delta > 0 ? chalk.green('↑') : chalk.red('↓')
    const deltaStr = r.delta > 0
      ? chalk.green(`${sign}${r.delta.toFixed(2)}`)
      : chalk.red(`${sign}${r.delta.toFixed(2)}`)
    const actor  = chalk.cyan(r.actor.padEnd(8))
    const target = chalk.magenta(r.target.padEnd(8))
    await p(`  ${actor} → ${target}  ${deltaStr}  ${arrow}  ${chalk.dim(`(${r.reason})`)}`, 35)
  }
}

// Town state
await p()
await p(SEP, 20)
await p(chalk.bold.white(`TOWN STATE — TICK ${tick}`), 60)
await p(SEP, 20)
await p()

for (const c of citizens) {
  const score  = socialStanding(c.name, citizens)
  const bar    = standingBar(score)
  const name   = c.name.toUpperCase().padEnd(8)
  const status = chalk.dim(citizenStatus(c, results))
  await p(`  ${chalk.bold(name)}  ${bar}  ${status}`, 45)
}

if (tradeNote) {
  await p()
  await p(`  ${chalk.yellow('⚡')} ${chalk.dim(tradeNote)}`, 40)
}

// Summary
await p()
await p(SEP, 20)
await p(chalk.italic.white(`  ${tickSummary(tick, results)}`), 100)
await p(SEP, 20)
await p()
