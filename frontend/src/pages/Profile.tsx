import { History, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { GameRow, RatingChart } from '../components/GameRow'
import { ratingHistory } from '../lib/chess'
import { Avatar, EmptyState, Spinner } from '../components/ui'
import { api } from '../lib/api'
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
  const history = ratingHistory(games, user.id)
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
              <span className="mx-2 text-baize-600" aria-hidden>/</span>
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
          {games.map((g) => (
            <GameRow key={g.id} game={g} userId={user.id} />
          ))}
        </ul>
      )}
    </div>
  )
}
