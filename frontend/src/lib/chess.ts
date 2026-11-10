import { Chess, type Square } from 'chess.js'
import type { Color, GameResult } from './types'

export interface Ply {
  san: string
  from: string
  to: string
  fen: string // position after the move
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** Replays a move list. Unknown/illegal moves stop the replay (defensive against bad data). */
export function replay(moves: { from: string; to: string; promotion?: string }[]): Ply[] {
  const chess = new Chess()
  const out: Ply[] = []
  for (const m of moves) {
    try {
      const r = chess.move({ from: m.from, to: m.to, promotion: m.promotion })
      out.push({ san: r.san, from: r.from, to: r.to, fen: chess.fen() })
    } catch {
      break
    }
  }
  return out
}

export function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined }
}

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 }
const ORDER = ['q', 'r', 'b', 'n', 'p']

/** Pieces each side has captured (by type) and the material balance from white's view. */
export function material(fen: string) {
  const placement = fen.split(' ')[0] ?? ''
  const count = { w: {} as Record<string, number>, b: {} as Record<string, number> }
  let score = 0
  for (const ch of placement) {
    if (!/[a-z]/i.test(ch)) continue
    const side = ch === ch.toUpperCase() ? 'w' : 'b'
    const t = ch.toLowerCase()
    count[side][t] = (count[side][t] ?? 0) + 1
    score += (side === 'w' ? 1 : -1) * (VALUES[t] ?? 0)
  }
  const captured = (victim: 'w' | 'b') =>
    ORDER.flatMap((t) => Array(Math.max(0, (START_COUNT[t] ?? 0) - (count[victim][t] ?? 0))).fill(t) as string[])
  // white captured black's pieces and vice versa
  return { byWhite: captured('b'), byBlack: captured('w'), balance: score }
}

export function checkedKingSquare(fen: string): Square | null {
  const chess = new Chess(fen)
  if (!chess.inCheck()) return null
  const turn = chess.turn()
  for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square
  return null
}

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms)
  if (clamped < 10_000) return `0:0${(Math.floor(clamped / 100) / 10).toFixed(1)}`
  const total = Math.ceil(clamped / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const REASONS: Record<string, string> = {
  checkmate: 'by checkmate',
  resignation: 'by resignation',
  timeout: 'on time',
  abandonment: 'by abandonment',
  stalemate: 'by stalemate',
  agreement: 'by agreement',
  'insufficient material': 'by insufficient material',
  'threefold repetition': 'by threefold repetition',
  'fifty-move rule': 'by the fifty-move rule',
  'timeout vs insufficient material': '— time out vs insufficient material',
  aborted: '',
}

export function resultHeadline(result: GameResult, you: Color | null): string {
  if (result.reason === 'aborted') return 'Game aborted'
  if (!result.winner) return 'Draw'
  if (!you) return `${result.winner === 'white' ? 'White' : 'Black'} wins`
  return result.winner === you ? 'You won' : 'You lost'
}

export const resultDetail = (result: GameResult) =>
  result.reason === 'aborted' ? 'No rating change' : (REASONS[result.reason] ?? result.reason)

export const resultScore = (r: GameResult) =>
  r.reason === 'aborted' ? '*' : r.winner === 'white' ? '1–0' : r.winner === 'black' ? '0–1' : '½–½'

export const colorLetter = (c: Color) => (c === 'white' ? 'w' : 'b')
export const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white')

export function downloadPgn(pgn: string, name: string) {
  const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.pgn` })
  a.click()
  URL.revokeObjectURL(url)
}
