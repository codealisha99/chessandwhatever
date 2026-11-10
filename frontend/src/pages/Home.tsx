import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../context/OnlineContext'
import { api } from '../lib/api'
import { TIME_CONTROLS } from '../lib/timeControls'
import type { Color } from '../lib/types'
import { ClockDemo } from './home/ClockDemo'
import { ClockGrid } from './home/ClockGrid'
import { ClockTile } from './home/ClockTile'
import { Desk } from './home/Desk'
import { EngineLadder } from './home/EngineLadder'
import { Faq } from './home/Faq'
import { FriendInvite } from './home/FriendInvite'
import { LiveGames } from './home/LiveGames'
import { OperaGame } from './home/OperaGame'

interface Stats {
  online: number
  playing: number
  waiting: number
  /** players queued per time control, e.g. { "5+3": 1 } */
  waitingBy?: Record<string, number>
  players: number
  games: number
}

type Pending = { kind: 'queue'; tc: string } | { kind: 'room'; tc: string; color: Color | 'random' } | null

/** offered again at the end of the landing story */
const CLOSING_TCS = ['3+2', '5+3', '10+0']

export default function Home() {
  const { user, playAsGuest } = useAuth()
  const { status, queuedFor, room, send, notify } = useOnline()
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const load = () => api<Stats>('/stats').then(setStats).catch(() => setStats(null))
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  // actions requested before the socket was ready (e.g. right after guest sign-in)
  useEffect(() => {
    if (!pending || status !== 'online') return
    if (pending.kind === 'queue') send({ type: 'queue', tc: pending.tc })
    else send({ type: 'create_room', tc: pending.tc, color: pending.color })
    setPending(null)
  }, [pending, status, send])

  async function ensureUser() {
    if (user) return true
    setBusy(true)
    try {
      await playAsGuest()
      return true
    } catch (e) {
      notify((e as Error).message, 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const searching = queuedFor ?? (pending?.kind === 'queue' ? pending.tc : null)

  async function quickPlay(tc: string) {
    if (searching === tc) {
      setPending(null)
      send({ type: 'cancel_queue' })
      return
    }
    if (await ensureUser()) setPending({ kind: 'queue', tc })
  }

  async function createRoom(tc: string, color: Color | 'random') {
    if (await ensureUser()) setPending({ kind: 'room', tc, color })
  }

  const waitingBy = stats?.waitingBy ?? {}
  return (
    <div className="mx-auto max-w-[1320px] px-5 pb-16 pt-10 sm:px-8 lg:pt-16">
      <section id="play" className="grid scroll-mt-24 gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)]" aria-label="Play">
        <div>
          <h1 className="display animate-rise text-[clamp(4.5rem,11vw,9.5rem)] text-baize-100">Your move.</h1>
          <p className="mt-6 max-w-[36rem] text-[17px] leading-relaxed text-baize-300">
            {user
              ? "Pick a clock and you'll be paired with the next player waiting for it."
              : "Rated chess against real people, timed by the server. Pick a clock and you'll be paired with the next player waiting for it. No sign-up: you get a guest account and a 1200 rating on the spot."}
          </p>

          <div className="mt-12">
            <ClockGrid searching={searching} busy={busy} waitingBy={waitingBy} onPick={quickPlay} />
          </div>

          <p className="mt-7 flex min-h-5 items-center gap-2 text-[13px] text-baize-400" aria-live="polite">
            {(searching || !!stats?.online) && <span className={`size-1.5 shrink-0 rounded-full bg-brass-500 ${searching ? 'animate-pulse' : ''}`} />}
            {searching
              ? 'Looking for an opponent. Tap the clock again to stop.'
              : stats?.online
                ? `${stats.online} ${stats.online === 1 ? 'player' : 'players'} online, ${stats.playing} ${stats.playing === 1 ? 'game' : 'games'} in progress.`
                : ''}
          </p>
        </div>

        {user ? <Desk user={user} /> : <OperaGame />}
      </section>

      <section className="mt-24 grid items-start gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-20" aria-label="More ways to play">
        <FriendInvite room={room} busy={busy} onCreate={createRoom} onCancel={() => send({ type: 'cancel_room' })} />
        <LiveGames />
      </section>

      {!user && (
        <div className="mt-32 space-y-32 sm:mt-40 sm:space-y-40">
          <ClockDemo />
          <EngineLadder />
          <Faq />
          <section className="felt-raised rounded-[32px] px-6 py-12 sm:px-12 sm:py-16" aria-labelledby="closing-heading">
            <h2 id="closing-heading" className="display text-[clamp(3rem,7vw,5.5rem)]">
              Pick a clock.
            </h2>
            <p className="mt-3 max-w-lg text-[16px] leading-relaxed text-baize-300">
              One click starts the search. If nobody is waiting yet, you'll be first in the queue for the next player who picks the same clock.
            </p>
            <div className="mt-9 grid max-w-2xl grid-cols-2 gap-x-3 gap-y-5 pt-1.5 sm:grid-cols-3">
              {TIME_CONTROLS.filter((t) => CLOSING_TCS.includes(t.id)).map((tc) => (
                <ClockTile key={tc.id} tc={tc} searching={searching === tc.id} disabled={busy} waiting={waitingBy[tc.id] ?? 0} onClick={() => quickPlay(tc.id)} />
              ))}
            </div>
            <a href="#play" className="mt-7 inline-block text-sm font-semibold text-baize-200 underline decoration-baize-600 underline-offset-4 hover:decoration-baize-200">
              See all eleven time controls
            </a>
          </section>
        </div>
      )}
    </div>
  )
}
