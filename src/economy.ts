import { BagsSDK } from '@bagsfm/bags-sdk'
import { Connection, PublicKey } from '@solana/web3.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Citizen } from './types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const citizensYamlPath = join(root, 'citizens.yaml')

// ─── SDK INIT ────────────────────────────────────────────────────────────────

const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  'confirmed'
)

const sdk = new BagsSDK(
  process.env.BAGS_API_KEY ?? '',
  connection,
  'confirmed'
)

const WAKE_MINT = process.env.WAKE_TOKEN_MINT
  ? new PublicKey(process.env.WAKE_TOKEN_MINT)
  : null

// ─── YAML HELPERS ────────────────────────────────────────────────────────────

interface CitizensYaml {
  wallets: Record<string, string>
  wake_mint: string
}

function loadYaml(): CitizensYaml {
  return parseYaml(readFileSync(citizensYamlPath, 'utf-8')) as CitizensYaml
}

function saveYaml(data: CitizensYaml) {
  writeFileSync(citizensYamlPath, stringifyYaml(data))
}

export function getWallets(): Record<string, string> {
  return loadYaml().wallets
}

export function setWallet(name: string, address: string) {
  const data = loadYaml()
  data.wallets[name] = address
  saveYaml(data)
}

// ─── BALANCE READING ─────────────────────────────────────────────────────────

const SYSTEM_PROGRAM = '11111111111111111111111111111111'

async function readWakeBalance(walletAddress: string): Promise<number> {
  if (!WAKE_MINT) return 0
  if (walletAddress === SYSTEM_PROGRAM) return 0

  try {
    const owner = new PublicKey(walletAddress)
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
      mint: WAKE_MINT
    })

    if (accounts.value.length === 0) return 0

    const balance = accounts.value[0]?.account.data.parsed?.info?.tokenAmount?.uiAmount
    return typeof balance === 'number' ? balance : 0
  } catch {
    return 0
  }
}

export interface CitizenBalance {
  name: string
  wallet: string
  wakeBalance: number
}

export async function getBalances(): Promise<CitizenBalance[]> {
  const wallets = getWallets()
  const results: CitizenBalance[] = []

  for (const [name, wallet] of Object.entries(wallets)) {
    const wakeBalance = await readWakeBalance(wallet)
    results.push({ name, wallet, wakeBalance })
  }

  return results
}

// ─── UPDATE CITIZEN STATE WITH BALANCES ──────────────────────────────────────

export async function updateCitizenBalances(citizens: Citizen[]): Promise<string[]> {
  const balances = await getBalances()
  const log: string[] = []

  for (const citizen of citizens) {
    const entry = balances.find(b => b.name.toLowerCase() === citizen.name.toLowerCase())
    if (!entry) continue

    const prev = (citizen as Citizen & { wakeBalance?: number }).wakeBalance ?? 0
    ;(citizen as Citizen & { wakeBalance?: number }).wakeBalance = entry.wakeBalance

    if (WAKE_MINT) {
      log.push(`  ${citizen.name}: ${prev} → ${entry.wakeBalance} $WAKE  (${entry.wallet.slice(0, 8)}…)`)
    }
  }

  return log
}

// ─── TRENCHER TRADE ──────────────────────────────────────────────────────────

export interface TradeResult {
  fired: boolean
  from?: string
  to?: string
  amount?: number
  reason?: string
}

export async function trencherTrade(trencher: Citizen, citizens: Citizen[]): Promise<TradeResult> {
  // 30% chance to trade each tick
  if (Math.random() > 0.30) return { fired: false }

  // Weight targets by relationship score (positive only)
  const targets = citizens
    .filter(c => c.name !== trencher.name)
    .map(c => {
      const key = Object.keys(trencher.relationships).find(
        k => k.toLowerCase() === c.name.toLowerCase()
      )
      const score = key ? (trencher.relationships[key] ?? 0) : 0
      return { citizen: c, score }
    })
    .filter(t => t.score > 0)

  if (targets.length === 0) return { fired: false, reason: 'no positive relationships to send to' }

  // Weighted random selection
  const totalWeight = targets.reduce((sum, t) => sum + t.score, 0)
  let roll = Math.random() * totalWeight
  const target = targets.find(t => { roll -= t.score; return roll <= 0 }) ?? targets[targets.length - 1]!

  // Amount: 1–10% of Trencher's balance, scaled by relationship
  const trencherExt = trencher as Citizen & { wakeBalance?: number }
  const balance = trencherExt.wakeBalance ?? 0

  if (balance <= 0) return { fired: false, reason: 'Trencher has no $WAKE to send' }

  const amount = parseFloat((balance * (0.01 + target.score * 0.09)).toFixed(4))

  // Update in-state balances (on-chain tx requires private key — not held here)
  trencherExt.wakeBalance = parseFloat((balance - amount).toFixed(4))
  const targetExt = target.citizen as Citizen & { wakeBalance?: number }
  targetExt.wakeBalance = parseFloat(((targetExt.wakeBalance ?? 0) + amount).toFixed(4))

  // Build a quote via Bags SDK for logging — actual execution requires wallet signing
  let quoteNote = ''
  if (WAKE_MINT && process.env.SOLANA_RPC_URL) {
    try {
      const wallets = getWallets()
      const targetWallet = wallets[target.citizen.name]
      if (targetWallet && targetWallet !== SYSTEM_PROGRAM) {
        quoteNote = ` [quote via Bags SDK: ${new PublicKey(targetWallet).toString().slice(0, 8)}…]`
      }
    } catch { /* best-effort */ }
  }

  return {
    fired: true,
    from: trencher.name,
    to: target.citizen.name,
    amount,
    reason: `relationship score ${target.score.toFixed(2)}${quoteNote}`
  }
}
