import { useEffect, useRef, useState } from 'react'
import { Clock } from '../../components/Clock'
import type { Color } from '../../lib/types'

// A 3 + 2 game played out on the real clock component, following the server's rules.
const BASE_MS = 180_000
const INC_MS = 2_000
/** illustrative think times, one per move */
const THINK_MS = [1400, 1200, 4300, 2600, 5800, 3100, 2200, 4700, 1600, 3900]

interface State {
  ms: Record<Color, number>
  turn: Color
  ply: number
  at: number
  note: string
}

const START: State = {
  ms: { white: BASE_MS, black: BASE_MS },
  turn: 'white',
  ply: 0,
  at: 0,
  note: 'White to make the first move. Neither clock is running yet.',
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, '0')}`
const name = (c: Color) => (c === 'white' ? 'White' : 'Black')

/** Advance one move: returns the next state and how long the mover thought. */
function step(s: State): State {
  const think = THINK_MS[s.ply % THINK_MS.length]!
  const next: Color = s.turn === 'white' ? 'black' : 'white'
  if (s.ply === 0) return { ...s, turn: next, ply: 1, at: performance.now(), note: "White's first move is free. Clocks start once both sides have moved." }
  if (s.ply === 1) return { ...s, turn: next, ply: 2, at: performance.now(), note: "Black replies, also free. Now White's clock is running." }
  const before = s.ms[s.turn]
  const after = before - think + INC_MS
  return {
    ms: { ...s.ms, [s.turn]: after },
    turn: next,
    ply: s.ply + 1,
    at: performance.now(),
    note: `${name(s.turn)} moved after ${secs(think)}: ${clock(before)} − ${secs(think)} + ${INC_MS / 1000}s increment = ${clock(after)}`,
  }
}

const RULES: [string, string][] = [
  ['Timed on the server', 'Think time is measured by the game server, so a slow device or a reload never changes your clock.'],
  ['Increment after every move', 'In 3 + 2, each move you make adds two seconds back to your clock.'],
  ['A fair start', 'Clocks start once both players have moved. Thirty seconds without a first move and the game is aborted, unrated.'],
  ['Flagging, done properly', 'Run out of time and you lose, unless your opponent has too little material to mate. Then it is a draw.'],
  ['Room to reconnect', 'Drop your connection and you have sixty seconds to come back. The clocks keep running while you are away.'],
]

export function ClockDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const [s, setS] = useState<State>(START)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || reduced) return
    const wait = s.ply < 2 ? 1500 : THINK_MS[s.ply % THINK_MS.length]!
    const t = setTimeout(() => setS((cur) => (cur.ply >= THINK_MS.length + 2 ? { ...START, at: performance.now() } : step(cur))), wait)
    return () => clearTimeout(t)
  }, [visible, reduced, s])

  const ticking = s.ply >= 2 && visible && !reduced ? s.turn : null
  return (
    <section className="grid items-center gap-x-20 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)]" aria-labelledby="clock-heading">
      <div>
        <h2 id="clock-heading" className="display text-[clamp(2.8rem,6vw,4.5rem)]">
          The server keeps the time.
        </h2>
        <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-baize-300">
          Every rated game runs on one authoritative clock. Both players, and anyone watching, see the same time.
        </p>
        <dl className="mt-9 grid gap-x-10 gap-y-6 sm:grid-cols-2">
          {RULES.map(([term, detail]) => (
            <div key={term} className="border-t border-white/[0.08] pt-4">
              <dt className="text-[15px] font-semibold text-baize-100">{term}</dt>
              <dd className="mt-1 text-[14px] leading-relaxed text-baize-400">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>

      <figure ref={ref} className="felt-raised rounded-[28px] p-6 sm:p-8">
        <div className="grid gap-x-4 gap-y-6 pt-2 min-[440px]:grid-cols-2">
          {(['white', 'black'] as const).map((c) => (
            <div key={c}>
              <Clock ms={s.ms[c]} at={s.at} ticking={ticking === c} size="lg" />
              <div className="mt-3 flex items-center gap-2 text-[13px] text-baize-400">
                <span className={`size-3 rounded-full ${c === 'white' ? 'bg-chalk-300' : 'bg-baize-950 ring-1 ring-white/20'}`} />
                {name(c)}
                {s.turn === c && <span className="text-brass-300">to move</span>}
              </div>
            </div>
          ))}
        </div>
        <figcaption className="annot mt-6 min-h-[3.2em] border-t border-white/[0.06] pt-4 text-[16px] leading-snug text-baize-200">
          {reduced ? 'Example, 3 + 2: White moved after 4.3s, so 3:00.0 − 4.3s + 2s increment = 2:57.7.' : s.note}
        </figcaption>
        <p className="mt-2 text-[12px] text-baize-500">Example game at 3 + 2, using the same clock the board uses.</p>
      </figure>
    </section>
  )
}
