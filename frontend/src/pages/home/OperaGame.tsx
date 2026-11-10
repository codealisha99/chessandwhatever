import { Chess } from 'chess.js'
import { useEffect, useMemo, useState } from 'react'
import { Board } from '../../components/Board'

// Paul Morphy vs Duke Karl of Brunswick & Count Isouard, Paris Opera, 1858.
const OPERA = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ')
const PLY_MS = 1300
const HOLD_END_MS = 5000

export function OperaGame() {
  const plies = useMemo(() => {
    const c = new Chess()
    return OPERA.map((san) => {
      const m = c.move(san)
      return { san, from: m.from, to: m.to, fen: c.fen() }
    })
  }, [])
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const [ply, setPly] = useState(reduced ? plies.length - 1 : -1)

  useEffect(() => {
    if (reduced) return
    const t = setTimeout(() => setPly((p) => (p >= plies.length - 1 ? -1 : p + 1)), ply >= plies.length - 1 ? HOLD_END_MS : ply < 0 ? 900 : PLY_MS)
    return () => clearTimeout(t)
  }, [ply, plies.length, reduced])

  const current = ply >= 0 ? plies[ply] : null
  const moveNo = ply >= 0 ? Math.floor(ply / 2) + 1 : 0
  return (
    <figure className="w-full max-w-[500px] animate-rise justify-self-center [animation-delay:120ms] lg:justify-self-end">
      <div className="pointer-events-none">
        <Board fen={current?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'} orientation="white" movable={null} lastMove={current} />
      </div>
      <figcaption className="mt-6 flex items-start justify-between gap-6">
        <span className="annot max-w-[19rem] text-[15px] leading-snug text-ink-300">
          Morphy against the Duke of Brunswick and Count Isouard, played in a box at the Paris Opera, 1858.
        </span>
        <span className="digits shrink-0 text-right text-[1.6rem] leading-none text-ink-200" aria-live="off">
          {current ? (
            <>
              <span className="text-ink-500">{moveNo}{ply % 2 === 0 ? '.' : '…'}</span> {current.san}
            </>
          ) : (
            <span className="text-ink-500">1.</span>
          )}
        </span>
      </figcaption>
    </figure>
  )
}
