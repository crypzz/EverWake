import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { interact, type InteractResult } from './interact.ts'
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

function saveTick(n: number) {
  writeFileSync(tickFile, JSON.stringify({ tick: n }, null, 2))
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

function printCitizen(c: Citizen) {
  const rels = Object.entries(c.relationships)
    .map(([k, v]) => {
      const bar = '█'.repeat(Math.round((v + 1) / 2 * 8)) + '░'.repeat(8 - Math.round((v + 1) / 2 * 8))
      const color = v > 0.3 ? chalk.green : v < -0.3 ? chalk.red : chalk.yellow
      return `${chalk.dim(k)} ${color(bar)} ${v.toFixed(2)}`
    })
    .join('  ')

  console.log(chalk.bold.cyan(`  ${c.name}`) + chalk.dim(` — ${c.occupation} @ ${c.location}`))
  console.log(`    ${chalk.dim('goal:')} ${c.goal}`)
  console.log(`    ${chalk.dim('rels:')} ${rels}`)
  console.log(`    ${chalk.dim('mem:')}  ${chalk.italic.dim(c.memories.slice(-1)[0] ?? '—')}`)
}

// ─── HEADER ─────────────────────────────────────────────────────────────────

const tick = loadTick() + 1
const width = 60

console.log('\n' + chalk.bold.yellow('╔' + '═'.repeat(width - 2) + '╗'))
console.log(chalk.bold.yellow('║') + chalk.bold.white(` ⚡  EVERWAKE  ─  TICK ${tick}`.padEnd(width - 3)) + chalk.bold.yellow('║'))
console.log(chalk.bold.yellow('║') + chalk.dim(` ${new Date().toLocaleTimeString()}  ·  ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`.padEnd(width - 2)) + chalk.bold.yellow('║'))
console.log(chalk.bold.yellow('╚' + '═'.repeat(width - 2) + '╝') + '\n')

// ─── LOAD CITIZENS ──────────────────────────────────────────────────────────

const citizens = readdirSync(citizensDir)
  .filter(f => f.endsWith('.json'))
  .map(f => loadCitizen(f))

console.log(chalk.bold('PRE-TICK STATE'))
console.log(chalk.dim('─'.repeat(width)))
citizens.forEach(printCitizen)

// ─── TICK ───────────────────────────────────────────────────────────────────

console.log('\n' + chalk.bold('INTERACTIONS'))
console.log(chalk.dim('─'.repeat(width)))

const results: InteractResult[] = []

for (let i = 0; i < citizens.length; i++) {
  for (let j = 0; j < citizens.length; j++) {
    if (i !== j) {
      const result = await interact(citizens[i]!, citizens[j]!)
      results.push(result)
    }
  }
}

// ─── RELATIONSHIP DELTA REPORT ───────────────────────────────────────────────

console.log('\n' + chalk.bold('RELATIONSHIP SHIFTS THIS TICK'))
console.log(chalk.dim('─'.repeat(width)))

const bigMoves = results
  .filter(r => Math.abs(r.delta) > 0.05)
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

if (bigMoves.length === 0) {
  console.log(chalk.dim('  No significant shifts.'))
} else {
  for (const r of bigMoves) {
    const arrow = r.delta > 0 ? chalk.green(`▲ +${r.delta.toFixed(2)}`) : chalk.red(`▼ ${r.delta.toFixed(2)}`)
    console.log(`  ${chalk.cyan(r.actor.padEnd(6))} → ${chalk.magenta(r.target.padEnd(6))}   ${r.before.toFixed(2)} → ${chalk.white(r.after.toFixed(2))}   ${arrow}`)
  }
}

// ─── SAVE STATE ─────────────────────────────────────────────────────────────

citizens.forEach(saveCitizen)
saveTick(tick)

// ─── GC EVENT BUS ────────────────────────────────────────────────────────────

console.log('\n' + chalk.bold('EMITTING TO GC BUS'))
console.log(chalk.dim('─'.repeat(width)))

const notableEvents: string[] = []

for (const r of results) {
  if (r.delta <= -0.15) {
    const msg = `${r.actor} and ${r.target} had a hostile encounter (${r.before.toFixed(2)} → ${r.after.toFixed(2)})`
    gcEmit('everwake.conflict', msg, { actor: r.actor, target: r.target, before: r.before, after: r.after })
    console.log(`  ${chalk.red('🔥')} event: ${chalk.dim('everwake.conflict')}  — ${msg}`)
    notableEvents.push(msg)
  } else if (r.delta >= 0.15) {
    const msg = `${r.actor} warmed to ${r.target} (${r.before.toFixed(2)} → ${r.after.toFixed(2)})`
    gcEmit('everwake.bond', msg, { actor: r.actor, target: r.target, before: r.before, after: r.after })
    console.log(`  ${chalk.green('💚')} event: ${chalk.dim('everwake.bond')}     — ${msg}`)
    notableEvents.push(msg)
  }
}

gcEmit('everwake.tick', `Tick ${tick} complete — ${results.length} interactions`, {
  tick,
  interactions: results.length,
  conflicts: results.filter(r => r.delta <= -0.15).length,
  bonds: results.filter(r => r.delta >= 0.15).length
})
console.log(`  ${chalk.yellow('⚡')} event: ${chalk.dim('everwake.tick')}      — tick ${tick} complete, ${results.length} interactions processed`)

// ─── MAYOR MAIL ──────────────────────────────────────────────────────────────

const worstPair = results.sort((a, b) => a.after - b.after)[0]!
const bestPair  = results.sort((a, b) => b.after - a.after)[0]!

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
  'State saved. Next tick in ~5m.',
].join('\n')

gcMail(`Tick ${tick} complete`, mailBody)

console.log('\n' + chalk.bold('MAYOR\'S INBOX'))
console.log(chalk.dim('─'.repeat(width)))
console.log(chalk.dim('  from: everwake'))
console.log(chalk.dim(`  subj: Tick ${tick} complete`))
console.log(chalk.dim('  ─────────────────────────'))
mailBody.split('\n').forEach(line => console.log(chalk.dim('  ') + (line.startsWith('EVERWAKE') || line.startsWith('NOTABLE') || line.startsWith('COLDEST') || line.startsWith('WARMEST') ? chalk.white(line) : chalk.dim(line))))

// ─── FOOTER ──────────────────────────────────────────────────────────────────

console.log('\n' + chalk.bold.yellow('╔' + '═'.repeat(width - 2) + '╗'))
console.log(chalk.bold.yellow('║') + chalk.bold.white(` ✓  TICK ${tick} SAVED  ·  next tick in ~5m`.padEnd(width - 3)) + chalk.bold.yellow('║'))
console.log(chalk.bold.yellow('╚' + '═'.repeat(width - 2) + '╝') + '\n')
