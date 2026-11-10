import { evalToShare, formatEval, type EngineLine } from '../lib/engine'
import type { Color } from '../lib/types'

export function EvalBar({ line, orientation }: { line: EngineLine | null; orientation: Color }) {
  const share = evalToShare(line)
  const whiteAhead = share >= 0.5
  return (
    <div className={`relative w-3.5 shrink-0 overflow-hidden rounded-md bg-ink-700 ring-1 ring-black/40 sm:w-5 ${orientation === 'black' ? 'rotate-180' : ''}`}>
      <div className="absolute inset-x-0 bottom-0 bg-ink-100 transition-[height] duration-500 ease-out" style={{ height: `${share * 100}%` }} />
      <div className="absolute inset-x-0 top-1/2 h-px bg-gold-400/50" />
      <span
        className={`absolute inset-x-0 hidden text-center font-mono text-[9px] font-bold sm:block ${orientation === 'black' ? 'rotate-180' : ''} ${
          whiteAhead ? 'text-ink-900' : 'text-ink-100'
        }`}
        style={whiteAhead ? { bottom: 4 } : { top: 4 }}
      >
        {formatEval(line)}
      </span>
    </div>
  )
}
