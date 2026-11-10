import { Link } from 'react-router-dom'
import { tcCategory } from '../lib/timeControls'
import { outcomeOf } from '../lib/chess'
import type { GameSummary } from '../lib/types'
import { Delta } from './ui'

/** One finished game from a player's point of view; links to the replay. */
export function GameRow({ game: g, userId, compact = false }: { game: GameSummary; userId: string; compact?: boolean }) {
  const asWhite = g.whiteId === userId
  const outcome = outcomeOf(g, userId)
  const opp = asWhite ? { name: g.blackName, rating: g.blackRating } : { name: g.whiteName, rating: g.whiteRating }
  return (
    <li>
      <Link
        to={`/game/${g.id}`}
        className={`-mx-3 grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 rounded-xl border-b border-white/[0.05] px-3 py-3.5 transition-colors hover:bg-white/[0.03] ${compact ? '' : 'sm:grid-cols-[2.5rem_1fr_6rem_auto]'}`}
      >
        <span
          className={`digits flex size-9 items-center justify-center rounded-lg text-[17px] ${
            outcome === 'win' ? 'bg-win/15 text-win' : outcome === 'loss' ? 'bg-loss/15 text-loss' : 'bg-white/5 text-ink-300'
          }`}
        >
          <span aria-hidden>{outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : '½'}</span>
          <span className="sr-only">{outcome === 'win' ? 'Won' : outcome === 'loss' ? 'Lost' : 'Drew'}</span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">
            <span className={`mr-2 inline-block size-2.5 rounded-full align-middle ${asWhite ? 'bg-chalk-300' : 'bg-ink-950 ring-1 ring-white/20'}`} />
            <span className="sr-only">{asWhite ? 'as white' : 'as black'} against </span>
            {opp.name} <span className="digits text-ink-500">{opp.rating}</span>
          </span>
          <span className="block text-[13px] text-ink-500">
            {tcCategory(g.tc)} {g.tc.replace('+', ' + ')}, {g.reason}, {Math.ceil(g.plies / 2)} moves
          </span>
        </span>
        {!compact && <span className="hidden text-right text-[13px] text-ink-500 sm:block">{new Date(g.endedAt).toLocaleDateString()}</span>}
        <span className="digits w-12 text-right text-[17px]">
          <Delta value={asWhite ? g.whiteDelta : g.blackDelta} />
        </span>
      </Link>
    </li>
  )
}

export function RatingChart({ values }: { values: number[] }) {
  const min = Math.min(...values) - 10
  const max = Math.max(...values) + 10
  const W = 800
  const H = 120
  const x = (i: number) => (i / (values.length - 1)) * W
  const y = (v: number) => H - ((v - min) / (max - min)) * H
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <figure className="mt-10">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label={`Rating over the last ${values.length} games, from ${values[0]} to ${values.at(-1)}`}>
        <path d={`${d} L${W},${H} L0,${H} Z`} fill="rgb(242 238 227 / 0.06)" />
        <path d={d} fill="none" stroke="rgb(242 238 227)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-2 flex justify-between text-[13px] text-ink-500">
        <span>Rating across the last {values.length} games</span>
        <span className="digits">
          {Math.min(...values)} to {Math.max(...values)}
        </span>
      </figcaption>
    </figure>
  )
}
