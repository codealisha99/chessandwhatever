import { Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, EmptyState, PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { User } from '../lib/types'

const score = (u: User) => (u.games ? Math.round(((u.wins + u.draws / 2) / u.games) * 100) : 0)

export default function Leaderboard() {
  const { user: me } = useAuth()
  const [rows, setRows] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<User[]>('/leaderboard').then(setRows).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-12 sm:px-8">
      <PageHeader title="Rankings" lede="Registered players by rating. Guest games count toward your rating, but only registered accounts are listed here." />
      {!rows && !error && <div className="py-20"><Spinner className="size-8" /></div>}
      {error && <EmptyState icon={<Trophy className="size-7" />} title="Rankings couldn't be loaded">{error}</EmptyState>}
      {rows?.length === 0 && (
        <EmptyState icon={<Trophy className="size-7" />} title="No ranked players yet">
          Create an account and finish a rated game to take the first spot.
        </EmptyState>
      )}
      {rows && rows.length > 0 && (
        <ol>
          <li className="grid grid-cols-[3.5rem_1fr_5rem] gap-4 border-b border-white/[0.07] pb-3 text-[13px] text-ink-500 sm:grid-cols-[3.5rem_1fr_6rem_6rem_5rem]">
            <span>Rank</span>
            <span>Player</span>
            <span className="hidden text-right sm:block">Games</span>
            <span className="hidden text-right sm:block">Score</span>
            <span className="text-right">Rating</span>
          </li>
          {rows.map((u, i) => {
            const top = i < 3
            return (
              <li key={u.id}>
                <Link
                  to={`/u/${u.username}`}
                  className={`grid grid-cols-[3.5rem_1fr_5rem] items-center gap-4 border-b border-white/[0.05] transition-colors hover:bg-white/[0.03] sm:grid-cols-[3.5rem_1fr_6rem_6rem_5rem] ${top ? 'py-5' : 'py-3'} ${u.id === me?.id ? 'bg-chalk-400/[0.06]' : ''}`}
                >
                  <span className={`digits ${top ? 'text-[2.4rem] text-ink-100' : 'text-[1.3rem] text-ink-500'}`}>{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={u.username} size={top ? 40 : 30} />
                    <span className={`truncate font-semibold ${top ? 'text-[17px]' : 'text-[15px]'}`}>
                      {u.username}
                      {u.id === me?.id && <span className="ml-2 text-[13px] font-normal text-ink-400">you</span>}
                    </span>
                  </span>
                  <span className="digits hidden text-right text-[17px] text-ink-400 sm:block">{u.games}</span>
                  <span className="digits hidden text-right text-[17px] text-ink-400 sm:block">{score(u)}%</span>
                  <span className={`digits text-right ${top ? 'text-[2rem]' : 'text-[1.3rem]'}`}>{u.rating}</span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
