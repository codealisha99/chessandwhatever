import { Chess } from 'chess.js'
import { Check, Copy, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Board, pieceUrl } from '../components/Board'
import { Button, Card } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../context/OnlineContext'
import { api } from '../lib/api'
import { TIME_CONTROLS, type TimeControlOption } from '../lib/timeControls'
import type { Color, LiveGame } from '../lib/types'

interface Stats {
  online: number
  playing: number
  waiting: number
  players: number
  games: number
}

type Pending = { kind: 'queue'; tc: string } | { kind: 'room'; tc: string; color: Color | 'random' } | null

const CATEGORIES: TimeControlOption['category'][] = ['Bullet', 'Blitz', 'Rapid', 'Classical']
const CATEGORY_NOTE: Record<TimeControlOption['category'], string> = {
  Bullet: 'Under three minutes',
  Blitz: 'Three to eight',
  Rapid: 'Ten to twenty-five',
  Classical: 'Half an hour or more',
}

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

  return (
    <div className="mx-auto max-w-[1320px] px-5 pb-16 pt-10 sm:px-8 lg:pt-16">
      <section className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div>
          <h1 className="display animate-rise text-[clamp(4.5rem,11vw,9.5rem)] text-baize-100">Your move.</h1>
          <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-baize-300">
            {user
              ? `Pick a clock and you'll be paired with the next player waiting for it. You're rated ${user.rating}.`
              : "Pick a clock and you'll be paired with the next player waiting for it. No sign-up needed: you get a guest account and a 1200 rating on the spot."}
          </p>

          <div className="mt-12 space-y-6">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="grid gap-3 sm:grid-cols-[9rem_1fr] sm:items-center">
                <div>
                  <div className="text-[15px] font-semibold text-baize-200">{cat}</div>
                  <div className="text-[13px] text-baize-500">{CATEGORY_NOTE[cat]}</div>
                </div>
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-4 pt-1.5 sm:grid-cols-4">
                  {TIME_CONTROLS.filter((t) => t.category === cat).map((tc) => (
                    <ClockTile key={tc.id} tc={tc} searching={searching === tc.id} disabled={busy} onClick={() => quickPlay(tc.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-7 flex h-5 items-center gap-2 text-[13px] text-baize-400" aria-live="polite">
            {(searching || !!stats?.online) && <span className={`size-1.5 rounded-full bg-brass-500 ${searching ? 'animate-pulse' : ''}`} />}
            {searching
              ? 'Looking for an opponent. Tap the clock again to stop.'
              : stats?.online
                ? `${stats.online} ${stats.online === 1 ? 'player' : 'players'} online, ${stats.playing} ${stats.playing === 1 ? 'game' : 'games'} in progress.`
                : ''}
          </p>
        </div>

        <OperaGame />
      </section>

      <section className="mt-24 grid items-start gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <FriendInvite room={room} busy={busy} onCreate={createRoom} onCancel={() => send({ type: 'cancel_room' })} />
        <div>
          <h2 className="text-xl font-semibold">Practice against Stockfish</h2>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-baize-400">
            Eight strengths, from a beginner who hangs pieces to full engine strength. Take moves back, ask for a hint, and analyse the game afterwards.
          </p>
          <Link to="/computer" className="felt-raised mt-5 inline-flex h-10 items-center rounded-[10px] px-4 text-sm font-semibold transition hover:brightness-125">
            Set up a practice game
          </Link>
        </div>
        <LiveGames />
      </section>
    </div>
  )
}

function ClockTile({ tc, searching, disabled, onClick }: { tc: TimeControlOption; searching: boolean; disabled: boolean; onClick: () => void }) {
  const [base, inc] = tc.id.split('+')
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!searching) return setSecs(0)
    const start = Date.now()
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [searching])

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={searching}
      aria-label={searching ? `Searching for a ${tc.label} game, select to cancel` : `Play ${base} minutes plus ${inc} seconds`}
      className={`clock-tile group relative flex h-[80px] items-center justify-between rounded-[14px] px-4 text-left transition-[background-color,box-shadow,transform] duration-150 active:translate-y-px ${
        searching ? 'bg-chalk-400 text-baize-950 shadow-[inset_0_-3px_0_rgb(0_0_0/0.1),0_0_0_1px_var(--color-brass-500),0_12px_30px_-12px_rgb(214_180_122/0.45)]' : 'felt-raised text-baize-100 hover:brightness-125'
      }`}
    >
      <span className="plunger" aria-hidden />
      <span className="digits flex items-baseline gap-1 text-[2.2rem] leading-none">
        {base}
        <span className={`text-[1.1rem] ${searching ? 'text-baize-600' : 'text-baize-500 group-hover:text-baize-400'}`}>+{inc}</span>
      </span>
      {searching ? (
        <span className="digits flex flex-col items-end text-[13px] leading-tight text-baize-700">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-brass-500" />
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
          </span>
          <X className="mt-1 size-3.5 opacity-60" />
        </span>
      ) : null}
    </button>
  )
}

// Paul Morphy vs Duke Karl of Brunswick & Count Isouard, Paris Opera, 1858.
const OPERA = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ')
const PLY_MS = 1300
const HOLD_END_MS = 5000

function OperaGame() {
  const plies = useMemo(() => {
    const c = new Chess()
    return OPERA.map((san) => {
      const m = c.move(san)
      return { san, from: m.from, to: m.to, fen: c.fen() }
    })
  }, [])
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const [ply, setPly] = useState(reduced ? plies.length - 1 : -1)

  useEffect(() => {
    if (reduced) return
    const t = setTimeout(() => setPly((p) => (p >= plies.length - 1 ? -1 : p + 1)), ply >= plies.length - 1 ? HOLD_END_MS : ply < 0 ? 900 : PLY_MS)
    return () => clearTimeout(t)
  }, [ply, plies.length, reduced])

  const current = ply >= 0 ? plies[ply] : null
  const moveNo = ply >= 0 ? Math.floor(ply / 2) + 1 : 0
  return (
    <figure className="w-full max-w-[500px] animate-rise justify-self-center [animation-delay:120ms] lg:justify-self-end">
      <div className="pointer-events-none">
        <Board fen={current?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'} orientation="white" movable={null} lastMove={current} />
      </div>
      <figcaption className="mt-6 flex items-start justify-between gap-6">
        <span className="annot max-w-[19rem] text-[15px] leading-snug text-baize-300">
          Morphy against the Duke of Brunswick and Count Isouard, played in a box at the Paris Opera, 1858.
        </span>
        <span className="digits shrink-0 text-right text-[1.6rem] leading-none text-baize-200" aria-live="off">
          {current ? (
            <>
              <span className="text-baize-500">{moveNo}{ply % 2 === 0 ? '.' : '…'}</span> {current.san}
            </>
          ) : (
            <span className="text-baize-500">1.</span>
          )}
        </span>
      </figcaption>
    </figure>
  )
}

function FriendInvite({
  room,
  busy,
  onCreate,
  onCancel,
}: {
  room: { code: string; tc: string } | null
  busy: boolean
  onCreate: (tc: string, color: Color | 'random') => void
  onCancel: () => void
}) {
  const [tc, setTc] = useState('10+0')
  const [color, setColor] = useState<Color | 'random'>('random')
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()
  const link = room ? `${location.origin}/join/${room.code}` : ''

  const copy = async () => {
    await navigator.clipboard.writeText(link).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <Card className="-mx-1 p-6 sm:p-7">
      <h2 className="text-xl font-semibold">Play a friend</h2>
      {room ? (
        <>
          <p className="mt-2 text-[15px] leading-relaxed text-baize-400">Send this link. The game starts as soon as they open it.</p>
          <div className="felt-sunk mt-5 rounded-2xl p-4">
            <div className="digits text-[2.6rem] leading-none tracking-[0.08em] text-baize-100">{room.code}</div>
            <div className="mt-2 truncate text-[13px] text-baize-500">{link}</div>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel invite
              </Button>
            </div>
          </div>
          <p className="mt-3 flex items-center gap-2 text-[13px] text-baize-500">
            <span className="size-1.5 animate-pulse rounded-full bg-flag" /> Waiting for your friend, {room.tc.replace('+', ' + ')}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-baize-400">Make a private, rated game and share the link. Choose the clock and your colour.</p>
          <div className="mt-5 flex flex-wrap gap-1.5">
            {['3+2', '5+0', '10+0', '15+10'].map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTc(id)}
                aria-pressed={tc === id}
                className={`digits h-9 rounded-lg px-3 text-[17px] transition ${tc === id ? 'bg-chalk-400 text-baize-950' : 'felt-raised text-baize-300 hover:text-baize-100'}`}
              >
                {id.replace('+', ' + ')}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {(['white', 'random', 'black'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`felt-raised flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-[13px] font-medium capitalize transition ${color === c ? 'text-baize-100 ring-2 ring-chalk-400' : 'text-baize-400 hover:text-baize-100'}`}
              >
                {c !== 'random' && <img src={pieceUrl(c === 'white' ? 'wK' : 'bK')} alt="" className="size-5" />}
                {c}
              </button>
            ))}
          </div>
          <Button variant="primary" className="mt-3 w-full" loading={busy} onClick={() => onCreate(tc, color)}>
            Create invite link
          </Button>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.length === 6) navigate(`/join/${code}`)
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase())}
              placeholder="Enter a code"
              aria-label="Invite code"
              className="felt-sunk digits h-10 min-w-0 flex-1 rounded-[10px] px-3 text-[17px] tracking-[0.12em] placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-baize-500 focus:outline-none focus:ring-2 focus:ring-chalk-400/50"
            />
            <Button type="submit" disabled={code.length !== 6}>
              Join
            </Button>
          </form>
        </>
      )}
    </Card>
  )
}

function LiveGames() {
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
