import { Bot, Check, Copy, Eye, Link2, Swords, Users, X, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Board, pieceUrl } from '../components/Board'
import { Button, Card } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../context/OnlineContext'
import { api } from '../lib/api'
import { TIME_CONTROLS } from '../lib/timeControls'
import type { Color } from '../lib/types'

interface Stats {
  online: number
  playing: number
  waiting: number
  players: number
  games: number
}

type Pending = { kind: 'queue'; tc: string } | { kind: 'room'; tc: string; color: Color | 'random' } | null

const HERO_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'

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

  async function quickPlay(tc: string) {
    if (queuedFor === tc) return send({ type: 'cancel_queue' })
    if (await ensureUser()) setPending({ kind: 'queue', tc })
  }

  async function createRoom(tc: string, color: Color | 'random') {
    if (await ensureUser()) setPending({ kind: 'room', tc, color })
  }

  const searching = queuedFor ?? (pending?.kind === 'queue' ? pending.tc : null)

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      {!user && <Hero />}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="animate-fade-up p-5 sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2.5 text-xl font-bold">
                <Zap className="size-5 text-gold-400" /> Quick pairing
              </h2>
              <p className="mt-1 text-sm text-ink-400">Rated game against the next player looking for the same time control.</p>
            </div>
            {stats && (
              <div className="hidden shrink-0 text-right text-xs text-ink-400 sm:block">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="size-1.5 rounded-full bg-win" /> <b className="tabular text-ink-200">{stats.online}</b> online
                </div>
                <div className="mt-0.5">
                  <b className="tabular text-ink-200">{stats.playing}</b> games in play
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {TIME_CONTROLS.map((tc) => {
              const active = searching === tc.id
              return (
                <button
                  key={tc.id}
                  type="button"
                  disabled={busy}
                  onClick={() => quickPlay(tc.id)}
                  className={`group relative flex h-24 flex-col items-center justify-center rounded-2xl transition-all duration-200 ${
                    active
                      ? 'animate-pulse-ring bg-gold-400/15 ring-2 ring-gold-400'
                      : 'bg-ink-800/80 ring-1 ring-inset ring-white/6 hover:-translate-y-0.5 hover:bg-ink-700 hover:ring-white/15'
                  }`}
                >
                  <span className={`tabular font-mono text-2xl font-semibold ${active ? 'text-gold-300' : 'text-ink-100'}`}>{tc.label}</span>
                  <span className="mt-1 text-xs font-medium text-ink-400">{active ? 'Searching… tap to cancel' : tc.category}</span>
                </button>
              )
            })}
            <Link
              to="/computer"
              className="flex h-24 flex-col items-center justify-center rounded-2xl bg-ink-800/40 text-ink-300 ring-1 ring-inset ring-dashed ring-white/10 transition hover:bg-ink-800 hover:text-ink-100"
            >
              <Bot className="size-6" />
              <span className="mt-1.5 text-xs font-medium">vs Computer</span>
            </Link>
          </div>

          {searching && <SearchingBanner tc={searching} onCancel={() => (setPending(null), send({ type: 'cancel_queue' }))} />}
        </Card>

        <div className="flex flex-col gap-6">
          <FriendCard room={room} busy={busy} onCreate={createRoom} onCancel={() => send({ type: 'cancel_room' })} />
          <ComputerCard />
          <Card className="animate-fade-up p-5 [animation-delay:240ms]">
            <Link to="/watch" className="group flex items-center justify-between">
              <span className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-ink-800 text-ink-300 ring-1 ring-white/5">
                  <Eye className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">Watch live games</span>
                  <span className="block text-xs text-ink-400">{stats ? `${stats.playing} in progress · ${stats.games} played all-time` : 'Spectate games in real time'}</span>
                </span>
              </span>
              <span className="text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-gold-400">→</span>
            </Link>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SearchingBanner({ tc, onCancel }: { tc: string; onCancel: () => void }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [tc])
  return (
    <div className="mt-6 flex animate-fade-up items-center justify-between gap-4 rounded-2xl bg-gold-400/8 p-4 ring-1 ring-gold-400/25">
      <div className="flex items-center gap-4">
        <div className="relative flex size-11 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-gold-400/30" />
          <img src={pieceUrl('wN')} alt="" className="relative size-9 animate-bounce" />
        </div>
        <div>
          <div className="font-semibold text-gold-200">Finding an opponent for {tc.replace('+', ' + ')}</div>
          <div className="tabular text-sm text-ink-400">
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} elapsed · you’ll be paired with the next player
          </div>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        <X className="size-4" /> Cancel
      </Button>
    </div>
  )
}

function FriendCard({
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
    <Card className="animate-fade-up p-5 [animation-delay:80ms]">
      <h3 className="flex items-center gap-2.5 font-bold">
        <Users className="size-5 text-gold-400" /> Play a friend
      </h3>
      {room ? (
        <div className="mt-4">
          <p className="text-sm text-ink-400">Send this link. The game starts the moment they open it.</p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-ink-950/60 p-1.5 pl-3 ring-1 ring-white/8">
            <Link2 className="size-4 shrink-0 text-ink-500" />
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink-200">{link}</span>
            <Button size="sm" variant="primary" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-ink-400">
              Code <b className="font-mono tracking-[0.2em] text-gold-300">{room.code}</b> · {room.tc.replace('+', ' + ')}
            </span>
            <button type="button" onClick={onCancel} className="text-sm font-medium text-ink-400 hover:text-loss">
              Cancel
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-ink-500">
            <span className="size-1.5 animate-pulse rounded-full bg-gold-400" /> Waiting for your friend…
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-4 gap-1.5">
            {TIME_CONTROLS.filter((t) => ['3+2', '5+0', '10+0', '15+10'].includes(t.id)).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTc(t.id)}
                className={`tabular h-9 rounded-lg font-mono text-sm font-semibold transition ${tc === t.id ? 'bg-gold-400 text-ink-950' : 'bg-ink-800 text-ink-300 hover:bg-ink-700'}`}
              >
                {t.id}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {(['white', 'random', 'black'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Play as ${c}`}
                onClick={() => setColor(c)}
                className={`flex h-10 flex-1 items-center justify-center rounded-lg transition ${color === c ? 'bg-ink-600 ring-2 ring-gold-400' : 'bg-ink-800 hover:bg-ink-700'}`}
              >
                {c === 'random' ? (
                  <span className="relative size-6">
                    <img src={pieceUrl('wK')} alt="" className="absolute inset-0 size-6 [clip-path:inset(0_50%_0_0)]" />
                    <img src={pieceUrl('bK')} alt="" className="absolute inset-0 size-6 [clip-path:inset(0_0_0_50%)]" />
                  </span>
                ) : (
                  <img src={pieceUrl(c === 'white' ? 'wK' : 'bK')} alt="" className="size-6" />
                )}
              </button>
            ))}
          </div>
          <Button variant="primary" className="mt-3 w-full" loading={busy} onClick={() => onCreate(tc, color)}>
            <Swords className="size-4" /> Create invite link
          </Button>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.trim().length === 6) navigate(`/join/${code.trim().toUpperCase()}`)
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase())}
              placeholder="Have a code?"
              aria-label="Invite code"
              className="h-10 min-w-0 flex-1 rounded-xl bg-ink-950/60 px-3 font-mono text-sm tracking-[0.2em] uppercase ring-1 ring-white/8 placeholder:tracking-normal placeholder:normal-case placeholder:text-ink-500 focus:outline-none focus:ring-gold-400/60"
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

function ComputerCard() {
  return (
    <Card className="group relative animate-fade-up overflow-hidden p-5 [animation-delay:160ms]">
      <div className="absolute -right-6 -top-6 size-32 rounded-full bg-gold-400/10 blur-2xl transition group-hover:bg-gold-400/20" />
      <Link to="/computer" className="relative flex items-center justify-between gap-4">
        <span className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-800 text-gold-300 ring-1 ring-white/10">
            <Bot className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">Play the computer</span>
            <span className="block text-xs text-ink-400">Stockfish 19 · 8 levels · hints & takebacks</span>
          </span>
        </span>
        <span className="text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-gold-400">→</span>
      </Link>
    </Card>
  )
}

function Hero() {
  const { playAsGuest } = useAuth()
  const { notify } = useOnline()
  const [busy, setBusy] = useState(false)
  return (
    <section className="mb-12 grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <div className="animate-fade-up">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-ink-300 ring-1 ring-white/10">
          <span className="size-1.5 rounded-full bg-win" /> Real-time · Rated · Free forever
        </div>
        <h1 className="font-display text-6xl leading-[0.95] tracking-tight text-ink-100 sm:text-7xl xl:text-8xl">
          Every move <br />
          <em className="bg-gradient-to-r from-gold-300 via-gold-400 to-gold-600 bg-clip-text text-transparent">matters.</em>
        </h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-300">
          Rated games from bullet to classical, private rooms for friends, live spectating and Stockfish analysis. Everything runs in your browser, with nothing to install.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await playAsGuest()
              } catch (e) {
                notify((e as Error).message, 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            <Swords className="size-5" /> Play as guest
          </Button>
          <Link to="/signup" className="inline-flex h-13 items-center rounded-xl bg-white/5 px-6 font-semibold ring-1 ring-white/10 transition hover:bg-white/10">
            Create free account
          </Link>
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-[460px] animate-fade-up [animation-delay:120ms]">
        <div className="absolute -inset-8 rounded-[3rem] bg-gold-400/10 blur-3xl" />
        <div className="relative rotate-[-2deg] transition duration-500 hover:rotate-0">
          <Board fen={HERO_FEN} orientation="white" movable={null} lastMove={{ from: 'd1', to: 'h5' }} arrows={[{ from: 'h5', to: 'f7', color: 'rgb(224 103 91 / 0.85)' }]} />
        </div>
      </div>
    </section>
  )
}
