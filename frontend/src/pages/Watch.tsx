import { Eye, Tv } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Board } from '../components/Board'
import { EmptyState, PageHeader, Spinner } from '../components/ui'
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
    <div className="mx-auto max-w-[1320px] px-5 py-12 sm:px-8">
      <PageHeader title="Watch" lede="Every game in progress, strongest pairings first. Open one to follow it move by move, with both clocks live.">
        {games && (
          <span className="flex items-center gap-2 text-sm text-baize-400">
            <span className="size-2 animate-pulse rounded-full bg-flag" /> {games.length} live
          </span>
        )}
      </PageHeader>
      {error && !games && <EmptyState icon={<Tv className="size-7" />} title="Live games couldn't be loaded">{error}</EmptyState>}
      {!games && !error && <div className="py-20"><Spinner className="size-8" /></div>}
      {games?.length === 0 && (
        <EmptyState icon={<Tv className="size-7" />} title="Nobody is playing right now">
          <Link to="/" className="font-semibold text-baize-100 underline underline-offset-4">Start a game</Link> and it will appear here for others to watch.
        </EmptyState>
      )}
      <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {games?.map((g) => (
          <Link key={g.id} to={`/play/${g.id}`} className="group block">
            <Row name={g.black.username} rating={g.black.rating} />
            <div className="pointer-events-none my-3 transition-transform duration-200 group-hover:-translate-y-1">
              <Board fen={g.fen} orientation="white" movable={null} />
            </div>
            <Row name={g.white.username} rating={g.white.rating} />
            <div className="mt-3 flex items-center justify-between text-[13px] text-baize-500">
              <span>
                {tcCategory(g.tc)} {g.tc.replace('+', ' + ')}, move {Math.max(1, Math.ceil(g.ply / 2))}
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
  <div className="flex items-baseline justify-between gap-3 text-[15px]">
    <span className="truncate font-semibold">{name}</span>
    <span className="digits text-baize-400">{rating}</span>
  </div>
)
