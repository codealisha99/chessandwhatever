import { Chess, type Square } from 'chess.js'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { BOARD_THEMES, useSettings } from '../context/SettingsContext'
import { checkedKingSquare } from '../lib/chess'
import type { Color } from '../lib/types'

export interface BoardMove {
  from: string
  to: string
  promotion?: 'q' | 'r' | 'b' | 'n'
}

export interface Arrow {
  from: string
  to: string
  color?: string
}

interface Props {
  fen: string
  orientation: Color
  /** which side the user may move; null = view only */
  movable: Color | 'both' | null
  lastMove?: { from: string; to: string } | null
  arrows?: Arrow[]
  onMove?: (move: BoardMove, san: string) => void
}

interface TrackedPiece {
  id: number
  code: string // e.g. "wN"
  sq: string
}

const FILES = 'abcdefgh'
const PIECE_NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
export const pieceUrl = (code: string) => `/pieces/${code[0] === 'w' ? 'white' : 'black'}-${PIECE_NAMES[code[1]!.toLowerCase()]}.svg`

function toXY(sq: string, orientation: Color): [number, number] {
  const f = FILES.indexOf(sq[0]!)
  const r = Number(sq[1]) - 1
  return orientation === 'white' ? [f, 7 - r] : [7 - f, r]
}

function fromXY(x: number, y: number, orientation: Color): string | null {
  if (x < 0 || x > 7 || y < 0 || y > 7) return null
  return orientation === 'white' ? `${FILES[x]}${8 - y}` : `${FILES[7 - x]}${y + 1}`
}

let nextId = 1

/** Keep piece identities stable across positions so moved pieces slide instead of blinking. */
function track(prev: TrackedPiece[], chess: Chess): TrackedPiece[] {
  const current = chess
    .board()
    .flat()
    .filter((p) => p !== null)
    .map((p) => ({ code: `${p.color}${p.type.toUpperCase()}`, sq: p.square as string }))
  const unused = new Set(prev)
  const out: (TrackedPiece | null)[] = current.map((c) => {
    const same = prev.find((p) => unused.has(p) && p.sq === c.sq && p.code === c.code)
    if (same) unused.delete(same)
    return same ?? null
  })
  current.forEach((c, i) => {
    if (out[i]) return
    const [cx, cy] = toXY(c.sq, 'white')
    let best: TrackedPiece | null = null
    let bestDist = Infinity
    for (const p of unused) {
      if (p.code !== c.code) continue
      const [px, py] = toXY(p.sq, 'white')
      const d = Math.hypot(px - cx, py - cy)
      if (d < bestDist) {
        best = p
        bestDist = d
      }
    }
    if (best) unused.delete(best)
    out[i] = { id: best?.id ?? nextId++, code: c.code, sq: c.sq }
  })
  return out as TrackedPiece[]
}

export function Board({ fen, orientation, movable, lastMove, arrows = [], onMove }: Props) {
  const { settings } = useSettings()
  const theme = BOARD_THEMES[settings.boardTheme]
  const chess = useMemo(() => {
    try {
      return new Chess(fen)
    } catch {
      return new Chess()
    }
  }, [fen])
  const boardRef = useRef<HTMLDivElement>(null)
  const trackedRef = useRef<TrackedPiece[]>([])
  const pieces = useMemo(() => {
    trackedRef.current = track(trackedRef.current, chess)
    return trackedRef.current
  }, [chess])

  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; wasSelected: boolean } | null>(null)
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null)
  const droppedRef = useRef<string | null>(null)

  const turn: Color = chess.turn() === 'w' ? 'white' : 'black'
  const canMove = movable !== null && (movable === 'both' || movable === turn) && !chess.isGameOver()

  // position changed under us (opponent moved, navigation) — drop any stale interaction
  useEffect(() => {
    setSelected(null)
    setPromotion(null)
    setDrag(null)
    const t = setTimeout(() => (droppedRef.current = null), 0)
    return () => clearTimeout(t)
  }, [fen])

  const targets = useMemo(() => {
    if (!selected || !canMove) return new Map<string, boolean>()
    const moves = chess.moves({ square: selected as Square, verbose: true })
    return new Map(moves.map((m) => [m.to as string, Boolean(m.captured)]))
  }, [selected, chess, canMove])

  const check = useMemo(() => checkedKingSquare(fen), [fen])

  const ownPiece = (sq: string) => {
    const p = chess.get(sq as Square)
    return p && canMove && (p.color === 'w' ? 'white' : 'black') === turn ? p : null
  }

  function attempt(from: string, to: string, promo?: BoardMove['promotion']): boolean {
    const legal = chess.moves({ square: from as Square, verbose: true }).filter((m) => m.to === to)
    if (legal.length === 0) return false
    if (legal.some((m) => m.promotion) && !promo) {
      if (settings.autoQueen) return attempt(from, to, 'q')
      setPromotion({ from, to })
      return true
    }
    const m = legal.find((x) => !x.promotion || x.promotion === promo) ?? legal[0]!
    setSelected(null)
    onMove?.({ from, to, ...(promo ? { promotion: promo } : {}) }, m.san)
    return true
  }

  function squareAt(clientX: number, clientY: number) {
    const rect = boardRef.current!.getBoundingClientRect()
    const x = Math.floor(((clientX - rect.left) / rect.width) * 8)
    const y = Math.floor(((clientY - rect.top) / rect.height) * 8)
    return fromXY(x, y, orientation)
  }

  function relPos(clientX: number, clientY: number) {
    const rect = boardRef.current!.getBoundingClientRect()
    return { x: ((clientX - rect.left) / rect.width) * 8, y: ((clientY - rect.top) / rect.height) * 8 }
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0 || promotion) return
    const sq = squareAt(e.clientX, e.clientY)
    if (!sq) return
    if (selected && sq !== selected && targets.has(sq)) {
      attempt(selected, sq)
      return
    }
    if (ownPiece(sq)) {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      setDrag({ from: sq, ...relPos(e.clientX, e.clientY), wasSelected: selected === sq })
      setSelected(sq)
      return
    }
    setSelected(null)
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (drag) setDrag({ ...drag, ...relPos(e.clientX, e.clientY) })
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (!drag) return
    const sq = squareAt(e.clientX, e.clientY)
    setDrag(null)
    if (sq && sq !== drag.from) {
      droppedRef.current = sq
      if (!attempt(drag.from, sq)) {
        droppedRef.current = null
        setSelected(null)
      }
    } else if (drag.wasSelected) {
      setSelected(null)
    }
  }

  const hoverSq = drag ? fromXY(Math.floor(drag.x), Math.floor(drag.y), orientation) : null
  const highlight = (sq: string) => (sq === selected ? theme.lastMove : lastMove && (sq === lastMove.from || sq === lastMove.to) ? theme.lastMove : null)

  const squares = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sq = fromXY(x, y, orientation)!
      const light = (x + y) % 2 === 0
      const hl = highlight(sq)
      const target = targets.get(sq)
      squares.push(
        <div
          key={sq}
          className="absolute"
          style={{ left: `${x * 12.5}%`, top: `${y * 12.5}%`, width: '12.5%', height: '12.5%', background: light ? theme.light : theme.dark }}
        >
          {hl && <div className="absolute inset-0" style={{ background: hl }} />}
          {sq === check && <div className="in-check absolute inset-0" />}
          {sq === hoverSq && target !== undefined && <div className="absolute inset-0 ring-4 ring-inset ring-white/60" />}
          {settings.showLegalMoves && target === false && <div className="move-dot absolute inset-0" />}
          {settings.showLegalMoves && target === true && <div className="capture-ring absolute inset-0" />}
        </div>,
      )
    }
  }

  const ranks = orientation === 'white' ? '87654321' : '12345678'
  const files = orientation === 'white' ? 'abcdefgh' : 'hgfedcba'

  return (
    <div className="board-shell">
      <div className="board-frame">
        {settings.coordinates && (
          <>
            <div className="board-coords ranks" aria-hidden>
              {[...ranks].map((r) => (
                <span key={r}>{r}</span>
              ))}
            </div>
            <div className="board-coords files" aria-hidden>
              {[...files].map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          </>
        )}
        <div
          ref={boardRef}
          className={`board ${settings.boardTheme === 'walnut' ? 'grain' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onContextMenu={(e) => e.preventDefault()}
          role="grid"
          aria-label="Chess board"
        >
          {squares}
          {pieces.map((p) => {
            const dragging = drag?.from === p.sq
            const [x, y] = toXY(p.sq, orientation)
            const tx = dragging ? drag.x - 0.5 : x
            const ty = dragging ? drag.y - 0.5 : y
            const animate = settings.animate && !dragging && droppedRef.current !== p.sq
            return (
              <div
                key={p.id}
                className={`board-piece ${animate ? 'animate' : ''} ${dragging ? 'dragging' : ''}`}
                style={{
                  transform: `translate(${tx * 100}%, ${ty * 100}%)`,
                  backgroundImage: `url(${pieceUrl(p.code)})`,
                  cursor: canMove ? 'grab' : 'default',
                }}
              />
            )
          })}
          {arrows.length > 0 && (
            <svg className="pointer-events-none absolute inset-0 z-[3] h-full w-full" viewBox="0 0 8 8">
              <defs>
                <marker id="arrowhead" markerWidth="3" markerHeight="3" refX="1.6" refY="1.5" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L3,1.5 L0,3 z" fill="context-stroke" />
                </marker>
              </defs>
              {arrows.map((a, i) => {
                const [x1, y1] = toXY(a.from, orientation)
                const [x2, y2] = toXY(a.to, orientation)
                const len = Math.hypot(x2 - x1, y2 - y1)
                const shorten = 0.35 / len
                return (
                  <line
                    key={i}
                    x1={x1 + 0.5}
                    y1={y1 + 0.5}
                    x2={x2 + 0.5 - (x2 - x1) * shorten}
                    y2={y2 + 0.5 - (y2 - y1) * shorten}
                    stroke={a.color ?? 'rgb(232 182 90 / 0.85)'}
                    strokeWidth={0.16}
                    strokeLinecap="round"
                    markerEnd="url(#arrowhead)"
                  />
                )
              })}
            </svg>
          )}
          {promotion && (
            <PromotionPicker
              color={turn}
              square={promotion.to}
              orientation={orientation}
              onPick={(p) => {
                const { from, to } = promotion
                setPromotion(null)
                attempt(from, to, p)
              }}
              onCancel={() => {
                setPromotion(null)
                setSelected(null)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function PromotionPicker({
  color,
  square,
  orientation,
  onPick,
  onCancel,
}: {
  color: Color
  square: string
  orientation: Color
  onPick: (p: 'q' | 'r' | 'b' | 'n') => void
  onCancel: () => void
}) {
  const [x, y] = toXY(square, orientation)
  const down = y === 0
  const options = ['q', 'n', 'r', 'b'] as const
  return (
    <div className="absolute inset-0 z-30 bg-black/50 backdrop-blur-[1px]" onPointerDown={(e) => (e.stopPropagation(), onCancel())}>
      {options.map((p, i) => (
        <button
          key={p}
          type="button"
          aria-label={`Promote to ${PIECE_NAMES[p]}`}
          className="absolute animate-pop rounded-full bg-baize-100 shadow-xl ring-1 ring-black/20 transition hover:bg-chalk-300"
          style={{
            left: `${x * 12.5}%`,
            top: `${(down ? y + i : y - i) * 12.5}%`,
            width: '12.5%',
            height: '12.5%',
            animationDelay: `${i * 30}ms`,
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            onPick(p)
          }}
        >
          <img src={pieceUrl(`${color === 'white' ? 'w' : 'b'}${p.toUpperCase()}`)} alt="" className="h-full w-full p-[6%]" draggable={false} />
        </button>
      ))}
    </div>
  )
}
