import { CalendarDays, History, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar, Card, Delta, EmptyState, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { tcCategory } from '../lib/timeControls'
import type { GameSummary, User } from '../lib/types'

interface ProfileData {
  user: User
  online: boolean
  games: GameSummary[]
}

export default function Profile() {
  const { username = '' } = useParams()
  const [data, setData] = useState<ProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    api<ProfileData>(`/users/${encodeURIComponent(username)}`).then(setData).catch((e: Error) => setError(e.message))
  }, [username])

  if (error) return <EmptyState icon={<UserX className="size-6" />} title="Player not found">{error}</EmptyState>
  if (!data) return <div className="flex justify-center py-24"><Spinner className="size-8" /></div>

  const { user, online, games } = data
  const winRate = user.games ? Math.round((user.wins / user.games) * 100) : 0
  const ratingHistory = games
    .slice()
    .reverse()
    .map((g) => (g.whiteId === user.id ? g.whiteRating + g.whiteDelta : g.blackRating + g.blackDelta))

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Card className="animate-fade-up p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-6">
          <Avatar name={user.username} size={84} online={online} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-5xl">{user.username}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-400">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-4" /> Joined {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </span>
              {user.isGuest && <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs">Guest</span>}
              <span className={online ? 'text-win' : ''}>{online ? '● Online now' : 'Offline'}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Rating</div>
            <div className="tabular font-display text-6xl leading-none text-gold-300">{user.rating}</div>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Games', user.games, 'text-ink-100'],
            ['Wins', user.wins, 'text-win'],
            ['Draws', user.draws, 'text-draw'],
            ['Losses', user.losses, 'text-loss'],
            ['Win rate', `${winRate}%`, 'text-ink-100'],
          ].map(([label, value, cls]) => (
            <div key={label} className="rounded-2xl bg-ink-800/70 p-4 ring-1 ring-white/5">
              <div className="text-xs font-medium text-ink-400">{label}</div>
              <div className={`tabular mt-1 text-2xl font-bold ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
        {user.games > 0 && (
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-ink-800">
            <div className="bg-win" style={{ width: `${(user.wins / user.games) * 100}%` }} />
            <div className="bg-draw/60" style={{ width: `${(user.draws / user.games) * 100}%` }} />
            <div className="bg-loss" style={{ width: `${(user.losses / user.games) * 100}%` }} />
          </div>
        )}
        {ratingHistory.length > 1 && <Sparkline values={ratingHistory} />}
      </Card>

      <h2 className="mb-4 mt-10 flex items-center gap-2 text-lg font-bold">
        <History className="size-5 text-gold-400" /> Recent games
      </h2>
      <Card className="overflow-hidden">
        {games.length === 0 ? (
          <EmptyState icon={<History className="size-6" />} title="No games yet">
            Rated games will show up here.
          </EmptyState>
        ) : (
          games.map((g) => {
            const asWhite = g.whiteId === user.id
            const score = g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === asWhite ? 'win' : 'loss'
            const opp = asWhite ? { name: g.blackName, rating: g.blackRating } : { name: g.whiteName, rating: g.whiteRating }
            return (
              <Link key={g.id} to={`/game/${g.id}`} className="flex items-center gap-4 border-b border-white/5 px-4 py-3.5 transition last:border-0 hover:bg-white/3">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                    score === 'win' ? 'bg-win/15 text-win' : score === 'loss' ? 'bg-loss/15 text-loss' : 'bg-white/5 text-ink-300'
                  }`}
                >
                  {score === 'win' ? 'W' : score === 'loss' ? 'L' : '½'}
                </span>
                <span className={`size-3 shrink-0 rounded-sm ring-1 ring-black/40 ${asWhite ? 'bg-ink-100' : 'bg-ink-950'}`} title={asWhite ? 'Played white' : 'Played black'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    vs {opp.name} <span className="tabular font-normal text-ink-400">({opp.rating})</span>
                  </span>
                  <span className="block text-xs text-ink-400">
                    {g.tc.replace('+', ' + ')} {tcCategory(g.tc)} · {g.reason} · {Math.ceil(g.plies / 2)} moves
                  </span>
                </span>
                <span className="tabular text-sm font-semibold">
                  <Delta value={asWhite ? g.whiteDelta : g.blackDelta} />
                </span>
                <span className="hidden w-24 text-right text-xs text-ink-500 sm:block">{new Date(g.endedAt).toLocaleDateString()}</span>
              </Link>
            )
          })
        )}
      </Card>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  const W = 600
  const H = 80
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - ((v - min) / span) * (H - 8) - 4}`)
  return (
    <div className="mt-6">
      <div className="mb-2 flex justify-between text-xs text-ink-500">
        <span>Rating over last {values.length} games</span>
        <span className="tabular">
          {min} – {max}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" preserveAspectRatio="none" role="img" aria-label="Rating history">
        <defs>
          <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgb(232 182 90)" stopOpacity="0.35" />
            <stop offset="1" stopColor="rgb(232 182 90)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill="url(#spark)" />
        <polyline points={pts.join(' ')} fill="none" stroke="rgb(232 182 90)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
