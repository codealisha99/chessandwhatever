// Mirrors backend1/src protocol + Game.view().
export type Color = 'white' | 'black'

export interface User {
  id: string
  username: string
  rating: number
  games: number
  wins: number
  losses: number
  draws: number
  isGuest: boolean
  createdAt: number
}

export interface PublicPlayer {
  id: string
  username: string
  rating: number
}

export interface WireMove {
  san: string
  from: string
  to: string
  promotion?: 'q' | 'r' | 'b' | 'n'
}

export interface Clocks {
  white: number
  black: number
  ticking: Color | null
  firstMoveMs: number | null
}

export interface GameResult {
  winner: Color | null
  reason: string
  whiteDelta: number
  blackDelta: number
}

export interface ChatLine {
  from: string
  text: string
  ts: number
}

export interface GameView {
  id: string
  tc: string
  white: PublicPlayer
  black: PublicPlayer
  you: Color | null
  moves: WireMove[]
  status: 'active' | 'finished'
  clocks: Clocks
  result: GameResult | null
  drawOfferFrom: Color | null
  rematchFrom: Color | null
  chat: ChatLine[]
  connected: Record<Color, boolean>
  abandonMs: Record<Color, number | null>
  spectators: number
}

export interface Room {
  code: string
  hostId: string
  tc: string
  color: Color | 'random'
}

export interface StoredMove {
  san: string
  uci: string
  clock: number
}

export interface GameRecord {
  id: string
  whiteId: string
  blackId: string
  whiteName: string
  blackName: string
  whiteRating: number
  blackRating: number
  whiteDelta: number
  blackDelta: number
  tc: string
  result: '1-0' | '0-1' | '1/2-1/2'
  reason: string
  pgn: string
  moves: StoredMove[]
  startedAt: number
  endedAt: number
}

export type GameSummary = Omit<GameRecord, 'moves' | 'pgn'> & { plies: number }

export interface LiveGame {
  id: string
  tc: string
  white: PublicPlayer
  black: PublicPlayer
  ply: number
  fen: string
  spectators: number
}
