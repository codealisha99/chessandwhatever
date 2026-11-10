import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GameRow } from '../../components/GameRow'
import { Spinner } from '../../components/ui'
import { useOnline } from '../../context/OnlineContext'
import { api } from '../../lib/api'
import { outcomeOf, ratingHistory } from '../../lib/chess'
import type { GameSummary, User } from '../../lib/types'

const RECENT = 5

/** A returning player's corner of the home page: any game in progress, their form, and recent results. */
export function Desk({ user }: { user: User }) {
  const { games: live } = useOnline()
  const [games, setGames] = useState<GameSummary[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<{ games: GameSummary[] }>(`/users/${encodeURIComponent(user.username)}`)
      .then((d) => !cancelled && setGames(d.games))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
    // refetch when the rating changes, i.e. after each finished game
  }, [user.username, user.rating])

  const current = Object.values(live).find((g) => g.you && g.status === 'active')
  const history = games ? ratingHistory(games, user.id) : []
  const form = games?.slice(0, 10).map((g) => outcomeOf(g, user.id)) ?? []

  return (
    <aside className="w-full max-w-[500px] lg:justify-self-end" aria-label="Your games">
      {current && (
        <Link
          to={`/play/${current.id}`}
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl bg-chalk-400 px-5 py-4 text-baize-950 shadow-[0_0_0_1px_var(--color-brass-500),0_16px_40px_-16px_rgb(214_180_122/0.5)] transition hover:bg-chalk-200"
        >
          <span>
            <span className="flex items-center gap-2 text-[13px] font-semibold text-baize-700">
              <span className="size-1.5 animate-pulse rounded-full bg-brass-700" /> Game in progress
            </span>
            <span className="mt-0.5 block text-[17px] font-semibold">
              Against {current.you === 'white' ? current.black.username : current.white.username}, {current.tc.replace('+', ' + ')}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            Resume <ArrowRight className="size-4" />
          </span>
        </Link>
      )}

      <div className="felt-raised rounded-[24px] p-6 sm:p-7">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="text-[13px] text-baize-400">Your rating</div>
            <div className="digits mt-1 text-[4.25rem] leading-[0.85]">{user.rating}</div>
          </div>
          {history.length > 1 && <Sparkline values={history} />}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-baize-400">
          <span>
            <span className="digits text-[15px] text-baize-100">{user.games}</span> {user.games === 1 ? 'game' : 'games'}
          </span>
          <span>
            <span className="digits text-[15px] text-win">{user.wins}</span> won
          </span>
          <span>
            <span className="digits text-[15px] text-draw">{user.draws}</span> drawn
          </span>
          <span>
            <span className="digits text-[15px] text-loss">{user.losses}</span> lost
          </span>
          {form.length > 0 && (
            <span className="flex gap-1" aria-label={`Last ${form.length} results, newest first: ${form.join(', ')}`}>
              {form.map((o, i) => (
                <span key={i} className={`h-3.5 w-1.5 rounded-sm ${o === 'win' ? 'bg-win' : o === 'loss' ? 'bg-loss' : 'bg-baize-500'}`} />
              ))}
            </span>
          )}
        </div>

        <h2 className="mt-7 border-t border-white/[0.06] pt-5 text-[15px] font-semibold">Recent games</h2>
        {error ? (
          <p className="mt-2 text-[14px] text-baize-400">Your games couldn't be loaded. They're still saved; try again in a moment.</p>
        ) : !games ? (
          <Spinner className="mt-4 size-5" />
        ) : games.length === 0 ? (
          <p className="annot mt-2 text-[16px] text-baize-300">Your first rated game will be written down here, ready to replay and analyse.</p>
        ) : (
          <ul className="mt-1">
            {games.slice(0, RECENT).map((g) => (
              <GameRow key={g.id} game={g} userId={user.id} compact />
            ))}
          </ul>
        )}
        <Link to={`/u/${user.username}`} className="mt-4 inline-block text-sm font-semibold text-baize-200 underline decoration-baize-600 underline-offset-4 hover:decoration-baize-200">
          {user.isGuest ? 'Your profile' : 'Full history and rating chart'}
        </Link>
      </div>
      {user.isGuest && (
        <p className="mt-4 text-[13px] leading-relaxed text-baize-500">
          You're playing as a guest. The rankings list named accounts only. <Link to="/signup" className="font-semibold text-baize-300 underline underline-offset-2">Create an account</Link>
        </p>
      )}
    </aside>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const W = 160
  const H = 48
  const min = Math.min(...values)
  const span = Math.max(1, Math.max(...values) - min)
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`).join(' ')
  const up = values.at(-1)! >= values[0]!
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-40 overflow-visible" role="img" aria-label={`Rating over your last ${values.length} games, from ${values[0]} to ${values.at(-1)}`}>
      <polyline points={pts} fill="none" stroke={up ? 'var(--color-win)' : 'var(--color-loss)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
