import { useEffect, useRef, useState } from 'react'
import { formatClock } from '../lib/chess'
import { playSound } from '../lib/sound'

const LOW_TIME_MS = 20_000

/** Server-synced clock: `ms` was correct at performance time `at`; counts down locally while `ticking`. */
export function Clock({ ms, at, ticking, warnSound = false, finished = false }: { ms: number; at: number; ticking: boolean; warnSound?: boolean; finished?: boolean }) {
  const [now, setNow] = useState(() => performance.now())
  const lastWarn = useRef<number | null>(null)

  useEffect(() => {
    if (!ticking) return
    let raf = 0
    const loop = () => {
      setNow(performance.now())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [ticking])

  const left = Math.max(0, ticking ? ms - (now - at) : ms)
  const low = left < LOW_TIME_MS
  const secs = Math.ceil(left / 1000)

  useEffect(() => {
    if (!ticking || !warnSound || secs > 10 || secs <= 0 || lastWarn.current === secs) return
    lastWarn.current = secs
    playSound('tick')
  }, [secs, ticking, warnSound])

  return (
    <div
      className={`tabular flex h-12 min-w-[7.5rem] items-center justify-end rounded-xl px-4 font-mono text-[1.65rem] font-semibold tracking-tight transition-colors duration-200 ${
        ticking
          ? low
            ? 'bg-loss text-white shadow-[0_0_24px_-4px_rgb(224_103_91/0.7)]'
            : 'bg-ink-100 text-ink-950 shadow-[0_0_24px_-8px_rgb(241_235_224/0.5)]'
          : finished || !low
            ? 'bg-ink-800 text-ink-300 ring-1 ring-inset ring-white/5'
            : 'bg-loss/20 text-loss ring-1 ring-inset ring-loss/30'
      }`}
      aria-label={`Clock ${formatClock(left)}`}
    >
      {formatClock(left)}
    </div>
  )
}
