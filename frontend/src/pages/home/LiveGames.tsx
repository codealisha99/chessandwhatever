import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { LiveGame } from '../../lib/types'

export function LiveGames() {
  const [games, setGames] = useState<LiveGame[] | null>(null)
  useEffect(() => {
    const load = () => api<LiveGame[]>('/games/live').then(setGames).catch(() => setGames(null))
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [])
  const top = games?.slice(0, 4) ?? []
  return (
    <div>
      <h2 className="text-xl font-semibold">Being played now</h2>
      {top.length === 0 ? (
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-baize-400">No games in progress. Start one above and it will show up here for others to watch.</p>
      ) : (
        <ul className="mt-4">
          {top.map((g) => (
            <li key={g.id}>
              <Link to={`/play/${g.id}`} className="-mx-3 flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]">
                <span className="min-w-0 text-[15px]">
                  <span className="block truncate font-medium">
                    {g.white.username} <span className="text-baize-500">v</span> {g.black.username}
                  </span>
                  <span className="text-[13px] text-baize-500">Move {Math.max(1, Math.ceil(g.ply / 2))}, {g.tc.replace('+', ' + ')}</span>
                </span>
                <span className="digits shrink-0 text-[15px] text-baize-400">{Math.round((g.white.rating + g.black.rating) / 2)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/watch" className="mt-4 inline-block text-sm font-semibold text-baize-200 underline decoration-baize-600 underline-offset-4 hover:decoration-baize-200">
        See all live games
      </Link>
    </div>
  )
}
