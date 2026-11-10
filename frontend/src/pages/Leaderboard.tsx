import { Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { User } from '../lib/types'

const MEDALS = ['from-gold-300 to-gold-600', 'from-ink-200 to-ink-400', 'from-[#e0a46f] to-[#9c5f2c]']

export default function Leaderboard() {
  const { user: me } = useAuth()
  const [rows, setRows] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<User[]>('/leaderboard').then(setRows).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Rankings" title="Leaderboard" />
      {!rows && !error && <div className="flex justify-center py-20"><Spinner className="size-8" /></div>}
      {error && <EmptyState icon={<Trophy className="size-6" />} title="Couldn't load rankings">{error}</EmptyState>}
      {rows?.length === 0 && (
        <Card>
          <EmptyState icon={<Trophy className="size-6" />} title="No ranked players yet">
            Finish a rated game with a registered account to appear here.
          </EmptyState>
        </Card>
      )}
      {rows && rows.length > 0 && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            {rows.slice(0, 3).map((u, i) => (
              <Link
                key={u.id}
                to={`/u/${u.username}`}
                className={`animate-fade-up rounded-2xl bg-ink-900/80 p-5 text-center ring-1 ring-white/6 transition hover:-translate-y-1 hover:ring-gold-400/30 ${i === 0 ? 'sm:order-2 sm:-mt-4' : i === 1 ? 'sm:order-1' : 'sm:order-3'}`}
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <div className={`mx-auto -mt-9 mb-3 flex size-9 items-center justify-center rounded-full bg-gradient-to-b font-bold text-ink-950 shadow-lg ${MEDALS[i]}`}>{i + 1}</div>
                <div className="flex justify-center">
                  <Avatar name={u.username} size={56} />
                </div>
                <div className="mt-3 truncate font-semibold">{u.username}</div>
                <div className="tabular mt-1 font-display text-4xl text-gold-300">{u.rating}</div>
                <div className="tabular mt-1 text-xs text-ink-400">
                  {u.wins}W · {u.draws}D · {u.losses}L
                </div>
              </Link>
            ))}
          </div>
          <Card className="overflow-hidden">
            <div className="grid grid-cols-[3rem_1fr_5rem_6rem] gap-2 border-b border-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-500 sm:grid-cols-[3rem_1fr_5rem_5rem_6rem]">
              <span>#</span>
              <span>Player</span>
              <span className="text-right">Rating</span>
              <span className="hidden text-right sm:block">Games</span>
              <span className="text-right">Win rate</span>
            </div>
            {rows.map((u, i) => (
              <Link
                key={u.id}
                to={`/u/${u.username}`}
                className={`grid grid-cols-[3rem_1fr_5rem_6rem] items-center gap-2 px-4 py-3 text-sm transition hover:bg-white/3 sm:grid-cols-[3rem_1fr_5rem_5rem_6rem] ${u.id === me?.id ? 'bg-gold-400/8' : ''}`}
              >
                <span className="tabular font-semibold text-ink-500">{i + 1}</span>
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={u.username} size={30} />
                  <span className="truncate font-semibold">{u.username}</span>
                </span>
                <span className="tabular text-right font-bold">{u.rating}</span>
                <span className="tabular hidden text-right text-ink-400 sm:block">{u.games}</span>
                <span className="tabular text-right text-ink-300">{u.games ? Math.round(((u.wins + u.draws / 2) / u.games) * 100) : 0}%</span>
              </Link>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
