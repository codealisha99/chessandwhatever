import { History, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar, Delta, EmptyState, Spinner } from '../components/ui'
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

  if (error) return <div className="mx-auto max-w-[1000px] px-5 py-12 sm:px-8"><EmptyState icon={<UserX className="size-7" />} title="No player by that name">{error}</EmptyState></div>
  if (!data) return <div className="mx-auto max-w-[1000px] px-5 py-24 sm:px-8"><Spinner className="size-8" /></div>

  const { user, online, games } = data
  const history = games
    .slice()
    .reverse()
    .map((g) => (g.whiteId === user.id ? g.whiteRating + g.whiteDelta : g.blackRating + g.blackDelta))
  const peak = history.length ? Math.max(...history, user.rating) : user.rating

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-12 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-8">
        <div className="flex items-center gap-5">
          <Avatar name={user.username} size={72} online={online} />
          <div className="min-w-0">
            <h1 className="display truncate text-[clamp(3rem,7vw,4.75rem)]">{user.username}</h1>
            <p className="mt-2 text-[15px] text-baize-400">
              {online ? <span className="text-win">Online now</span> : 'Offline'}
              <span className="mx-2 text-baize-600">/</span>
              {user.isGuest ? 'Guest account' : `Member since ${new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="digits text-[clamp(4rem,9vw,6.5rem)] leading-[0.85]">{user.rating}</div>
          <div className="mt-2 text-[13px] text-baize-500">Rating, peak {peak}</div>
        </div>
      </header>

      <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] sm:grid-cols-4">
        {[
          ['Games', user.games, 'text-baize-100'],
          ['Won', user.wins, 'text-win'],
          ['Drawn', user.draws, 'text-draw'],
          ['Lost', user.losses, 'text-loss'],
        ].map(([label, value, cls]) => (
          <div key={label} className="bg-baize-900 px-5 py-4">
            <dt className="text-[13px] text-baize-500">{label}</dt>
            <dd className={`digits mt-1 text-[2.25rem] leading-none ${cls}`}>{value}</dd>
          </div>
        ))}
      </dl>

      {history.length > 1 && <RatingChart values={history} />}

      <h2 className="mb-2 mt-14 flex items-center gap-2 text-xl font-semibold">Recent games</h2>
      {games.length === 0 ? (
        <EmptyState icon={<History className="size-7" />} title="No rated games yet">
          Finished rated games appear here, with a link to replay and analyse each one.
        </EmptyState>
      ) : (
        <ul>
          {games.map((g) => {
            const asWhite = g.whiteId === user.id
            const outcome = g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === asWhite ? 'win' : 'loss'
            const opp = asWhite ? { name: g.blackName, rating: g.blackRating } : { name: g.whiteName, rating: g.whiteRating }
            return (
              <li key={g.id}>
                <Link to={`/game/${g.id}`} className="-mx-3 grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 rounded-xl border-b border-white/[0.05] px-3 py-3.5 transition-colors hover:bg-white/[0.03] sm:grid-cols-[2.5rem_1fr_6rem_auto]">
                  <span
                    className={`digits flex size-9 items-center justify-center rounded-lg text-[17px] ${
                      outcome === 'win' ? 'bg-win/15 text-win' : outcome === 'loss' ? 'bg-loss/15 text-loss' : 'bg-white/5 text-baize-300'
                    }`}
                    aria-label={outcome}
                  >
                    {outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : '½'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">
                      <span className={`mr-2 inline-block size-2.5 rounded-full align-middle ${asWhite ? 'bg-chalk-300' : 'bg-baize-950 ring-1 ring-white/20'}`} />
                      {opp.name} <span className="digits text-baize-500">{opp.rating}</span>
                    </span>
                    <span className="block text-[13px] text-baize-500">
                      {tcCategory(g.tc)} {g.tc.replace('+', ' + ')}, {g.reason}, {Math.ceil(g.plies / 2)} moves
                    </span>
                  </span>
                  <span className="hidden text-right text-[13px] text-baize-500 sm:block">{new Date(g.endedAt).toLocaleDateString()}</span>
                  <span className="digits w-12 text-right text-[17px]">
                    <Delta value={asWhite ? g.whiteDelta : g.blackDelta} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function RatingChart({ values }: { values: number[] }) {
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
      <figcaption className="mt-2 flex justify-between text-[13px] text-baize-500">
        <span>Rating across the last {values.length} games</span>
        <span className="digits">
          {Math.min(...values)} to {Math.max(...values)}
        </span>
      </figcaption>
    </figure>
  )
}
