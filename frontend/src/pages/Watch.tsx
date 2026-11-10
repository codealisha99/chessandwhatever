import { Eye, Tv } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Board } from '../components/Board'
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { tcCategory } from '../lib/timeControls'
import type { LiveGame } from '../lib/types'

const POLL_MS = 4000

export default function Watch() {
  const [games, setGames] = useState<LiveGame[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = () =>
      api<LiveGame[]>('/games/live')
        .then((g) => (setGames(g), setError(null)))
        .catch((e: Error) => setError(e.message))
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Spectate" title="Live now">
        {games && (
          <span className="flex items-center gap-2 text-sm text-ink-400">
            <span className="size-2 animate-pulse rounded-full bg-loss" /> {games.length} game{games.length === 1 ? '' : 's'} in progress
          </span>
        )}
      </PageHeader>
      {error && !games && <EmptyState icon={<Tv className="size-6" />} title="Couldn't load live games">{error}</EmptyState>}
      {!games && !error && <div className="flex justify-center py-20"><Spinner className="size-8" /></div>}
      {games?.length === 0 && (
        <Card>
          <EmptyState icon={<Tv className="size-6" />} title="No games right now">
            Nobody's playing at the moment. <Link to="/" className="font-semibold text-gold-300">Start one</Link> and you'll be the main event.
          </EmptyState>
        </Card>
      )}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {games?.map((g, i) => (
          <Link
            key={g.id}
            to={`/play/${g.id}`}
            className="group animate-fade-up rounded-2xl bg-ink-900/80 p-3 ring-1 ring-white/6 transition hover:-translate-y-1 hover:ring-gold-400/40"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <Row name={g.black.username} rating={g.black.rating} />
            <div className="my-2 pointer-events-none">
              <Board fen={g.fen} orientation="white" movable={null} />
            </div>
            <Row name={g.white.username} rating={g.white.rating} />
            <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2.5 text-xs text-ink-400">
              <span>
                {g.tc.replace('+', ' + ')} · {tcCategory(g.tc)} · move {Math.ceil(g.ply / 2) || 1}
              </span>
              <span className="flex items-center gap-1">
                <Eye className="size-3.5" /> {g.spectators}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

const Row = ({ name, rating }: { name: string; rating: number }) => (
  <div className="flex items-center justify-between px-1 text-sm">
    <span className="truncate font-semibold">{name}</span>
    <span className="tabular text-ink-400">{rating}</span>
  </div>
)
