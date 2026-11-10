import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TimeControlOption } from '../../lib/timeControls'

/** One time control as a chess-clock button. `waiting` = other players queued for it right now. */
export function ClockTile({ tc, searching, disabled, waiting = 0, onClick }: { tc: TimeControlOption; searching: boolean; disabled: boolean; waiting?: number; onClick: () => void }) {
  const [base, inc] = tc.id.split('+')
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!searching) return setSecs(0)
    const start = Date.now()
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [searching])

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={searching}
      aria-label={searching ? `Searching for a ${tc.label} game, select to cancel` : `Play ${base} minutes plus ${inc} seconds${waiting ? `, ${waiting} waiting` : ''}`}
      className={`clock-tile group relative flex h-[80px] items-center justify-between rounded-[14px] px-4 text-left transition-[background-color,box-shadow,transform] duration-150 active:translate-y-px ${
        searching ? 'bg-chalk-400 text-ink-950 shadow-[inset_0_-3px_0_rgb(0_0_0/0.1),0_0_0_1px_var(--color-accent-500),0_12px_30px_-12px_rgb(91_140_255/0.45)]' : 'felt-raised text-ink-100 hover:brightness-125'
      }`}
    >
      <span className="plunger" aria-hidden />
      <span className="digits flex items-baseline gap-1 text-[2.2rem] leading-none">
        {base}
        <span className={`text-[1.1rem] ${searching ? 'text-ink-600' : 'text-ink-500 group-hover:text-ink-400'}`}>+{inc}</span>
      </span>
      {searching ? (
        <span className="digits flex flex-col items-end text-[13px] leading-tight text-ink-700">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-accent-500" />
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
          </span>
          <X className="mt-1 size-3.5 opacity-60" />
        </span>
      ) : waiting > 0 ? (
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-accent-300" aria-hidden>
          <span className="size-1.5 rounded-full bg-accent-500" />
          {waiting} waiting
        </span>
      ) : null}
    </button>
  )
}
