import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface Props {
  sans: string[]
  /** index of the ply being viewed; -1 = start position */
  cursor: number
  onJump: (ply: number) => void
  footer?: string
}

export function MoveList({ sans, cursor, onJump, footer }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const last = sans.length - 1

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-current="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, sans.length])

  // keyboard navigation (ignored while typing in inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'ArrowLeft') onJump(Math.max(-1, cursor - 1))
      else if (e.key === 'ArrowRight') onJump(Math.min(last, cursor + 1))
      else if (e.key === 'ArrowUp' || e.key === 'Home') onJump(-1)
      else if (e.key === 'ArrowDown' || e.key === 'End') onJump(last)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cursor, last, onJump])

  const rows = []
  for (let i = 0; i < sans.length; i += 2) rows.push(i)

  const cell = (ply: number) =>
    ply < sans.length ? (
      <button
        type="button"
        data-current={ply === cursor}
        onClick={() => onJump(ply)}
        className={`rounded-md px-2 py-1 text-left font-medium transition ${
          ply === cursor ? 'bg-gold-400/20 text-gold-300' : 'text-ink-200 hover:bg-white/5'
        }`}
      >
        {sans[ply]}
      </button>
    ) : (
      <span />
    )

  const nav = [
    { icon: ChevronFirst, to: -1, label: 'First move' },
    { icon: ChevronLeft, to: Math.max(-1, cursor - 1), label: 'Previous move' },
    { icon: ChevronRight, to: Math.min(last, cursor + 1), label: 'Next move' },
    { icon: ChevronLast, to: last, label: 'Last move' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="scroll-thin min-h-[120px] flex-1 overflow-y-auto px-2 py-2 text-sm">
        {sans.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-ink-500">No moves yet</div>
        ) : (
          <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-y-0.5">
            {rows.map((i) => (
              <div key={i} className="contents">
                <span className="tabular py-1 pl-2 text-ink-500">{i / 2 + 1}.</span>
                {cell(i)}
                {cell(i + 1)}
              </div>
            ))}
          </div>
        )}
        {footer && <div className="mt-3 border-t border-white/5 pt-3 text-center text-sm font-semibold text-ink-300">{footer}</div>}
      </div>
      <div className="grid grid-cols-4 gap-1 border-t border-white/5 p-2">
        {nav.map(({ icon: Icon, to, label }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            disabled={sans.length === 0}
            onClick={() => onJump(to)}
            className="flex h-9 items-center justify-center rounded-lg text-ink-300 transition hover:bg-white/5 hover:text-ink-100 disabled:opacity-30"
          >
            <Icon className="size-5" />
          </button>
        ))}
      </div>
    </div>
  )
}
