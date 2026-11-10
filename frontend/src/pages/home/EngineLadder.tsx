import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BOT_LEVELS } from '../../lib/engine'

const MAX_ELO = 3000
const eloOf = (s: string) => Number(s.replace(/\D/g, ''))

/** The eight practice levels on one rating scale. Each rung opens practice at that level. */
export function EngineLadder() {
  const [active, setActive] = useState(3)
  const lvl = BOT_LEVELS[active - 1]!
  return (
    <section aria-labelledby="ladder-heading">
      <div className="grid gap-x-20 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-end">
        <h2 id="ladder-heading" className="display text-[clamp(2.8rem,6vw,4.5rem)]">
          Eight opponents, one engine.
        </h2>
        <p className="text-[16px] leading-relaxed text-baize-300">
          Stockfish 19 runs in your browser at eight strengths, unrated. Take moves back, ask for a hint, then send the game to the analysis board.
        </p>
      </div>

      {/* wide screens: the levels placed on a rating scale */}
      <div className="relative mt-16 hidden h-36 md:block">
        <div className="absolute inset-x-0 top-[46px] h-px bg-gradient-to-r from-baize-600 via-baize-500 to-brass-500" aria-hidden />
        <ol className="contents">
          {BOT_LEVELS.map((l) => {
            const on = l.level === active
            return (
              <li key={l.level} className="absolute top-0 -translate-x-1/2" style={{ left: `${(eloOf(l.elo) / MAX_ELO) * 100}%` }}>
                <Link
                  to={`/computer?level=${l.level}`}
                  onMouseEnter={() => setActive(l.level)}
                  onFocus={() => setActive(l.level)}
                  aria-label={`Practice against ${l.name}, level ${l.level}, ${l.elo}`}
                  className="group flex flex-col items-center gap-2.5 rounded-xl px-2 py-1 focus-visible:outline-offset-4"
                >
                  <span className={`whitespace-nowrap text-[14px] font-semibold transition-colors ${on ? 'text-baize-100' : 'text-baize-400 group-hover:text-baize-200'}`}>{l.name}</span>
                  <span
                    className={`size-3.5 rounded-full ring-4 ring-baize-900 transition-transform duration-200 ${on ? 'scale-125 bg-brass-400' : 'bg-baize-400 group-hover:bg-baize-200'}`}
                    aria-hidden
                  />
                  <span className={`digits mt-5 text-[13px] ${on ? 'text-brass-300' : 'text-baize-500'}`}>{l.elo}</span>
                </Link>
              </li>
            )
          })}
        </ol>
      </div>
      <div className="mt-2 hidden items-baseline justify-between gap-6 border-t border-white/[0.06] pt-5 md:flex" aria-live="polite">
        <p className="annot text-[18px] text-baize-200">
          {lvl.name}: {lvl.note}
        </p>
        <Link to={`/computer?level=${lvl.level}`} className="shrink-0 text-sm font-semibold text-baize-100 underline decoration-baize-600 underline-offset-4 hover:decoration-baize-100">
          Play {lvl.name}
        </Link>
      </div>

      {/* small screens: the same levels as a list */}
      <ol className="mt-10 divide-y divide-white/[0.06] md:hidden">
        {BOT_LEVELS.map((l) => (
          <li key={l.level}>
            <Link to={`/computer?level=${l.level}`} className="flex items-baseline justify-between gap-4 py-3.5">
              <span>
                <span className="block text-[15px] font-semibold">{l.name}</span>
                <span className="annot block text-[15px] text-baize-400">{l.note}</span>
              </span>
              <span className="digits shrink-0 text-[15px] text-baize-400">{l.elo}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
