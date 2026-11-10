import { useEffect, useRef, useState } from 'react'
import { formatClock } from '../lib/chess'
import { playSound } from '../lib/sound'

const LOW_TIME_MS = 20_000
/** the flag on an analog clock starts lifting in the last minute */
const FLAG_WINDOW_MS = 60_000

/**
 * Server-synced clock: `ms` was correct at performance time `at`; counts down locally while `ticking`.
 * Styled after an analog tournament clock: an ivory face while running, a recessed one while waiting,
 * and a red flag that rises during the final minute.
 */
export function Clock({
  ms,
  at,
  ticking,
  warnSound = false,
  finished = false,
  size = 'md',
}: {
  ms: number
  at: number
  ticking: boolean
  warnSound?: boolean
  finished?: boolean
  size?: 'md' | 'lg'
}) {
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
  const flagLift = Math.max(0, Math.min(1, 1 - left / FLAG_WINDOW_MS))

  useEffect(() => {
    if (!ticking || !warnSound || secs > 10 || secs <= 0 || lastWarn.current === secs) return
    lastWarn.current = secs
    playSound('tick')
  }, [secs, ticking, warnSound])

  const face = ticking
    ? low
      ? 'bg-flag text-white shadow-[0_0_0_1px_rgb(0_0_0/0.2),0_10px_30px_-10px_rgb(224_83_61/0.8)]'
      : 'bg-chalk-400 text-ink-950 shadow-[inset_0_-3px_0_rgb(0_0_0/0.1),0_10px_30px_-14px_rgb(242_238_227/0.5)]'
    : low && !finished
      ? 'felt-sunk text-loss'
      : 'felt-sunk text-ink-300'

  return (
    <div className="relative">
      {/* the running side's plunger stands up; the waiting side's is pressed down */}
      {!finished && <span aria-hidden className={`plunger ${ticking ? 'on' : ''}`} style={{ translate: ticking ? '-50% -2px' : '-50% 3px' }} />}
      <div
        className={`digits relative flex items-center justify-end overflow-hidden transition-colors duration-200 ${
          size === 'lg' ? 'h-16 min-w-[10rem] rounded-2xl px-5 text-[2.75rem]' : 'h-14 min-w-[8.5rem] rounded-[14px] px-4 text-[2.15rem]'
        } ${face}`}
        role="timer"
        aria-label={`${formatClock(left)} remaining`}
      >
        {flagLift > 0 && !finished && (
          <span
            aria-hidden
            className={`absolute left-3 top-1/2 h-4 w-3 origin-bottom-left transition-transform duration-500 ${ticking && low ? 'bg-white' : 'bg-flag'}`}
            style={{ clipPath: 'polygon(0 0, 100% 50%, 0 100%)', transform: `translateY(-50%) rotate(${-90 + flagLift * 90}deg)` }}
          />
        )}
        <span className="leading-none">{formatClock(left)}</span>
      </div>
    </div>
  )
}
