export interface Citizen {
  name: string
  occupation: string
  traits: string[]
  money: number
  energy: number
  hunger?: number
  relationships: Record<string, number>
  memories: string[]
  goal: string
  location: string
  wakeBalance?: number
}
