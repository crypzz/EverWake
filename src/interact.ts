import chalk from 'chalk'
import { think } from './brain.ts'
import type { Citizen } from './types.ts'

function scoreBar(score: number): string {
  const filled = Math.round((score + 1) / 2 * 10)
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
  const color = score > 0.3 ? chalk.green : score < -0.3 ? chalk.red : chalk.yellow
  return color(`[${bar}]`)
}

function deltaLabel(delta: number): string {
  if (delta > 0.05) return chalk.green(`▲ +${delta.toFixed(2)}`)
  if (delta < -0.05) return chalk.red(`▼ ${delta.toFixed(2)}`)
  return chalk.gray(`► ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`)
}

export interface InteractResult {
  actor: string
  target: string
  thoughts: string
  dialogue: string
  memory: string
  before: number
  after: number
  delta: number
}

export async function interact(a: Citizen, b: Citizen): Promise<InteractResult> {
  const key = Object.keys(a.relationships).find(
    k => k.toLowerCase() === b.name.toLowerCase()
  ) ?? b.name

  const before = a.relationships[key] ?? 0

  // Print header before the API call so it feels live
  process.stdout.write(
    chalk.bold(`\n  ${chalk.cyan(a.name)} `) +
    chalk.dim('─────────────────→') +
    chalk.bold(` ${chalk.magenta(b.name)}\n`)
  )
  process.stdout.write(chalk.dim('  ⏳ thinking...\r'))

  const { thoughts, dialogue, memory, relationshipDelta } = await think(a, b)

  const after = Math.max(-1, Math.min(1, before + relationshipDelta))
  a.relationships[key] = after
  a.memories.push(memory)

  // Clear the "thinking..." line and print results
  process.stdout.write('                    \r')

  console.log(chalk.dim('  ┌─ internal ') + chalk.dim('─'.repeat(44)))
  console.log(chalk.dim('  │ ') + chalk.italic.gray(thoughts))
  console.log(chalk.dim('  └') + chalk.dim('─'.repeat(55)))

  console.log(`  ${chalk.white('◆')} ${chalk.white(dialogue)}`)
  console.log(`  ${chalk.dim('memory:')} ${chalk.dim.italic(memory)}`)

  const scoreLine = `  ${chalk.dim('relation:')} ${scoreBar(before)} ${chalk.dim(before.toFixed(2))} → ${scoreBar(after)} ${chalk.white(after.toFixed(2))}  ${deltaLabel(after - before)}`
  console.log(scoreLine)

  return { actor: a.name, target: b.name, thoughts, dialogue, memory, before, after, delta: after - before }
}
