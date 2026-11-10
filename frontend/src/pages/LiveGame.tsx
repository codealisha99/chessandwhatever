import { Download, Eye, Flag, FlipVertical2, Handshake, LineChart, MessageSquare, RotateCcw, Send, Swords, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Board } from '../components/Board'
import { Clock } from '../components/Clock'
import { Modal } from '../components/Modal'
import { MoveList } from '../components/MoveList'
import { PlayerStrip } from '../components/PlayerStrip'
import { Button, Card, Delta, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useOnline, type LiveGame as LiveGameState } from '../context/OnlineContext'
import { useSettings } from '../context/SettingsContext'
import { downloadPgn, material, opposite, replay, resultDetail, resultHeadline, resultScore, START_FEN } from '../lib/chess'
import { tcCategory } from '../lib/timeControls'
import type { Color } from '../lib/types'

/** re-renders every `ms` while enabled; returns performance.now() */
function useNow(enabled: boolean, ms = 250) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(performance.now()), ms)
    return () => clearInterval(t)
  }, [enabled, ms])
  return now
}

export default function LiveGame() {
  const { id = '' } = useParams()
  const { user, loading } = useAuth()
  const { games, missing, status, send } = useOnline()
  const navigate = useNavigate()
  const game = games[id]

  // not in memory yet (deep link / refresh / spectating) — ask the server for a snapshot
  useEffect(() => {
    if (!game && status === 'online') send({ type: 'spectate', gameId: id })
  }, [game, status, id, send])

  // the game is no longer live on the server — show the archived version
  useEffect(() => {
    if (missing[id] && !game) navigate(`/game/${id}`, { replace: true })
  }, [missing, id, game, navigate])

  // stop receiving updates for games we were only watching
  useEffect(() => {
    return () => {
      if (game && !game.you) send({ type: 'unspectate', gameId: id })
    }
  }, [id, !!game, game?.you, send]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!user && !loading) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <Eye className="mx-auto size-10 text-baize-500" />
        <h1 className="mt-4 display text-4xl">Sign in to watch live</h1>
        <p className="mt-2 text-baize-400">Live games stream over a realtime connection that needs an account. A guest account works too.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to={`/login?next=/play/${id}`} className="rounded-xl bg-baize-100 px-5 py-2.5 font-semibold text-baize-950">
            Sign in
          </Link>
          <Link to={`/game/${id}`} className="rounded-xl bg-white/5 px-5 py-2.5 font-semibold ring-1 ring-white/10">
            View archive
          </Link>
        </div>
      </div>
    )
  }
  if (!game) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-baize-400">
        <Spinner className="size-8" />
        Loading game…
      </div>
    )
  }
  return <GameScreen key={game.id} game={game} />
}

function GameScreen({ game }: { game: LiveGameState }) {
  const { send, move } = useOnline()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [flipped, setFlipped] = useState(false)
  const [cursor, setCursor] = useState<number | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  const you = game.you
  const active = game.status === 'active'
  const plies = useMemo(() => replay(game.moves), [game.moves])
  const lastIdx = plies.length - 1
  const shown = cursor === null ? lastIdx : Math.min(cursor, lastIdx)
  const fen = shown >= 0 ? plies[shown]!.fen : START_FEN
  const live = cursor === null || cursor >= lastIdx
  const bottom: Color = flipped ? opposite(you ?? 'white') : (you ?? 'white')
  const top = opposite(bottom)
  const mat = material(fen)
  const turn: Color = plies.length % 2 === 0 ? 'white' : 'black'
  const now = useNow(active)

  // open the result dialog exactly when the game ends while we're watching
  const wasActive = useRef(active)
  useEffect(() => {
    if (wasActive.current && !active) setShowResult(true)
    wasActive.current = active
  }, [active])

  useEffect(() => {
    if (cursor !== null && cursor >= lastIdx) setCursor(null)
  }, [cursor, lastIdx])

  useEffect(() => {
    const base = 'Gambit'
    document.title = active && you && turn === you ? `Your move – ${base}` : `${game.white.username} v ${game.black.username} – ${base}`
    return () => {
      document.title = 'Gambit — Play chess online'
    }
  }, [active, you, turn, game.white.username, game.black.username])

  const jump = useCallback((ply: number) => setCursor(ply >= lastIdx ? null : ply), [lastIdx])

  const strip = (color: Color) => {
    const p = game[color]
    const isTop = color === top
    const captured = color === 'white' ? mat.byWhite : mat.byBlack
    const adv = color === 'white' ? mat.balance : -mat.balance
    const abandon = game.abandonAt[color]
    const offline = active && !game.connected[color]
      ? abandon !== null
        ? `Disconnected, forfeits in ${Math.max(0, Math.ceil((abandon - now) / 1000))}s`
        : 'Disconnected'
      : undefined
    const clockMs = game.clocks[color]
    return (
      <div className={isTop ? 'mb-4' : 'mt-4'}>
        <PlayerStrip
          name={p.username}
          rating={p.rating}
          color={color}
          captured={captured}
          advantage={adv}
          active={active && turn === color}
          offline={offline}
          delta={game.result && game.result.reason !== 'aborted' ? (color === 'white' ? game.result.whiteDelta : game.result.blackDelta) : null}
          right={<Clock ms={clockMs} at={game.clocksAt} ticking={game.clocks.ticking === color} warnSound={color === you} finished={!active} size="lg" />}
        />
      </div>
    )
  }

  const firstMoveLeft = active && game.clocks.firstMoveMs !== null ? Math.max(0, Math.ceil((game.clocks.firstMoveMs - (now - game.clocksAt)) / 1000)) : null

  return (
    <div className="mx-auto max-w-7xl px-3 pb-10 pt-4 sm:px-6 lg:pt-6">
      <h1 className="sr-only">
        {game.white.username} against {game.black.username}, {game.tc.replace('+', ' + ')}
      </h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,calc(100dvh-290px))_360px] lg:justify-center lg:gap-10">
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-290px))] min-w-[280px]">
          {strip(top)}
          <div className="relative">
            <Board
              fen={fen}
              orientation={bottom}
              movable={active && you && live ? you : null}
              lastMove={shown >= 0 ? plies[shown] : null}
              onMove={(m, san) => move(game.id, m, san)}
            />
            {firstMoveLeft !== null && you && turn === you && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
                <div className="animate-pop rounded-2xl bg-baize-950/85 px-5 py-3 text-center shadow-2xl ring-1 ring-brass-500/50 backdrop-blur">
                  <div className="text-sm font-semibold text-brass-300">Your move</div>
                  <div className="tabular text-xs text-baize-300">Game aborts in {firstMoveLeft}s</div>
                </div>
              </div>
            )}
            {!live && (
              <button
                type="button"
                onClick={() => setCursor(null)}
                className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 animate-pop rounded-full bg-chalk-400 px-4 py-1.5 text-xs font-bold text-baize-950 shadow-xl"
              >
                Back to live position
              </button>
            )}
          </div>
          {strip(bottom)}
        </div>

        <Card className="flex max-h-[calc(100dvh-110px)] min-h-[420px] flex-col overflow-hidden lg:sticky lg:top-20">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="digits text-[17px]">{game.tc.replace('+', ' + ')}</span> {tcCategory(game.tc)}
              </div>
              <div className="text-xs text-baize-400">
                {you ? 'Rated game' : 'Watching'}
                {game.spectators > 0 && `, ${game.spectators} ${game.spectators === 1 ? 'spectator' : 'spectators'}`}
              </div>
            </div>
            <div className="flex gap-1">
              <IconBtn label="Flip board (F)" onClick={() => setFlipped((f) => !f)}>
                <FlipVertical2 className="size-4" />
              </IconBtn>
              <IconBtn label="Chat" onClick={() => setChatOpen((o) => !o)} active={chatOpen}>
                <MessageSquare className="size-4" />
              </IconBtn>
            </div>
          </div>

          {chatOpen ? (
            <Chat game={game} />
          ) : (
            <MoveList sans={plies.map((p) => p.san)} cursor={shown} onJump={jump} footer={game.result ? `${resultScore(game.result)}, ${resultHeadline(game.result, null).toLowerCase()} ${resultDetail(game.result)}` : undefined} />
          )}

          {active && game.drawOfferFrom && you && game.drawOfferFrom !== you && (
            <div className="flex animate-pop items-center justify-between gap-2 bg-chalk-400 px-4 py-3 text-baize-950">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Handshake className="size-4" /> Your opponent offers a draw
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="primary" onClick={() => send({ type: 'draw_respond', gameId: game.id, accept: true })}>
                  Accept
                </Button>
                <Button size="sm" variant="ghost" onClick={() => send({ type: 'draw_respond', gameId: game.id, accept: false })}>
                  Decline
                </Button>
              </div>
            </div>
          )}

          <div className="border-t border-white/5 p-3">
            {active && you ? (
              <GameActions game={game} confirmResign={settings.confirmResign} />
            ) : game.result ? (
              <ResultActions game={game} onShow={() => setShowResult(true)} />
            ) : (
              <div className="py-1 text-center text-xs text-baize-500">Watching live</div>
            )}
          </div>
        </Card>
      </div>

      <Modal open={showResult && !!game.result} onClose={() => setShowResult(false)} label="Game over">
        {game.result && <ResultDialog game={game} onAnalyse={() => navigate(`/game/${game.id}`)} />}
      </Modal>
      <KeyboardFlip onFlip={() => setFlipped((f) => !f)} />
    </div>
  )
}

function KeyboardFlip({ onFlip }: { onFlip: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'f' || e.key === 'F') onFlip()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onFlip])
  return null
}

function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex size-8 items-center justify-center rounded-lg transition ${active ? 'bg-chalk-400/15 text-chalk-300' : 'text-baize-400 hover:bg-white/5 hover:text-baize-100'}`}
    >
      {children}
    </button>
  )
}

function GameActions({ game, confirmResign }: { game: LiveGameState; confirmResign: boolean }) {
  const { send } = useOnline()
  const [confirming, setConfirming] = useState(false)
  const canAbort = game.moves.length < 2
  const offered = game.drawOfferFrom === game.you

  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(t)
  }, [confirming])

  if (canAbort) {
    return (
      <Button className="w-full" variant="secondary" onClick={() => send({ type: 'abort', gameId: game.id })}>
        <X className="size-4" /> Abort game
      </Button>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button disabled={offered} onClick={() => send({ type: 'draw_offer', gameId: game.id })}>
        <Handshake className="size-4" /> {offered ? 'Draw offered' : 'Offer draw'}
      </Button>
      <Button
        variant={confirming ? 'danger' : 'secondary'}
        onClick={() => {
          if (confirmResign && !confirming) return setConfirming(true)
          send({ type: 'resign', gameId: game.id })
        }}
      >
        <Flag className="size-4" /> {confirming ? 'Confirm resign' : 'Resign'}
      </Button>
    </div>
  )
}

function useRematch(game: LiveGameState) {
  const { send, games } = useOnline()
  const theirOffer = game.rematchFrom && game.rematchFrom !== game.you
  const myOffer = game.rematchFrom === game.you
  const opponentGone = game.you ? !game.connected[opposite(game.you)] : true
  // a newer game between the same players means the rematch already started
  const started = Object.values(games).some((g) => g.id !== game.id && g.status === 'active' && g.you)
  return {
    theirOffer,
    myOffer,
    disabled: !game.you || opponentGone || myOffer || started,
    offer: () => send({ type: 'rematch_offer', gameId: game.id }),
    decline: () => send({ type: 'rematch_decline', gameId: game.id }),
  }
}

function ResultActions({ game, onShow }: { game: LiveGameState; onShow: () => void }) {
  const rm = useRematch(game)
  const navigate = useNavigate()
  return (
    <div className="flex flex-col gap-2">
      {rm.theirOffer && (
        <div className="flex animate-pop items-center justify-between rounded-xl bg-chalk-400 px-3 py-2 text-sm text-baize-950">
          <span className="font-semibold">Rematch?</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" onClick={rm.offer}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" onClick={rm.decline}>
              Decline
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {game.you ? (
          <Button size="sm" disabled={rm.disabled && !rm.theirOffer} onClick={rm.offer}>
            <RotateCcw className="size-4" /> {rm.myOffer ? 'Sent' : 'Rematch'}
          </Button>
        ) : (
          <Button size="sm" onClick={onShow}>
            Result
          </Button>
        )}
        <Button size="sm" onClick={() => navigate('/')}>
          <Swords className="size-4" /> New
        </Button>
        <Button size="sm" onClick={() => navigate(`/game/${game.id}`)} disabled={game.result?.reason === 'aborted'}>
          <LineChart className="size-4" /> Analyse
        </Button>
      </div>
    </div>
  )
}

function ResultDialog({ game, onAnalyse }: { game: LiveGameState; onAnalyse: () => void }) {
  const result = game.result!
  const navigate = useNavigate()
  const { send } = useOnline()
  const rm = useRematch(game)
  const you = game.you
  const won = you && result.winner === you
  const lost = you && result.winner && result.winner !== you
  const delta = you ? (you === 'white' ? result.whiteDelta : result.blackDelta) : null
  const aborted = result.reason === 'aborted'

  return (
    <div className="text-center">

      <h2 className={`display text-6xl ${won ? 'text-win' : lost ? 'text-loss' : 'text-baize-100'}`}>{resultHeadline(result, you)}</h2>
      <p className="mt-1 text-baize-400">{resultDetail(result) || ' '}</p>

      {!aborted && (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {(['white', 'black'] as const).map((c) => (
            <div key={c} className={`rounded-2xl bg-baize-800 p-3 ring-1 ${c === you ? 'ring-chalk-400/40' : 'ring-white/5'}`}>
              <div className="truncate text-sm font-semibold">{game[c].username}</div>
              <div className="digits mt-1 text-[2.4rem] leading-none">
                {game[c].rating + (c === 'white' ? result.whiteDelta : result.blackDelta)}
              </div>
              <div className="tabular text-sm font-semibold">
                <Delta value={c === 'white' ? result.whiteDelta : result.blackDelta} />
              </div>
            </div>
          ))}
        </div>
      )}
      {delta !== null && !aborted && <p className="sr-only">Rating change {delta}</p>}

      <div className="mt-6 grid gap-2">
        {you && (
          <Button variant="primary" size="lg" disabled={rm.disabled && !rm.theirOffer} onClick={rm.offer}>
            <RotateCcw className="size-4" />
            {rm.theirOffer ? 'Accept rematch' : rm.myOffer ? 'Rematch offer sent…' : 'Rematch'}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => (send({ type: 'queue', tc: game.tc }), navigate('/'))}>
            <Swords className="size-4" /> New {game.tc}
          </Button>
          <Button onClick={onAnalyse} disabled={aborted}>
            <LineChart className="size-4" /> Analyse
          </Button>
        </div>
        {game.pgn && !aborted && (
          <Button variant="ghost" size="sm" onClick={() => downloadPgn(game.pgn!, `${game.white.username}_vs_${game.black.username}`)}>
            <Download className="size-4" /> Download PGN
          </Button>
        )}
      </div>
    </div>
  )
}

function Chat({ game }: { game: LiveGameState }) {
  const { send } = useOnline()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [game.chat.length])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-thin min-h-[120px] flex-1 space-y-2 overflow-y-auto p-4 text-sm">
        {game.chat.length === 0 && <div className="py-6 text-center text-baize-500">Say hi — be kind.</div>}
        {game.chat.map((l, i) => (
          <div key={i} className="break-words">
            <span className={`font-semibold ${l.from === game.white.username ? 'text-baize-100' : 'text-baize-400'}`}>{l.from}</span>{' '}
            <span className="text-baize-300">{l.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {game.you && (
        <form
          className="flex gap-2 border-t border-white/5 p-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = text.trim()
            if (!t) return
            send({ type: 'chat', gameId: game.id, text: t })
            setText('')
          }}
        >
          <input
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message"
            aria-label="Chat message"
            className="h-9 min-w-0 flex-1 rounded-lg bg-baize-950/60 px-3 text-sm ring-1 ring-white/8 focus:outline-none focus:ring-chalk-400/50"
          />
          <button type="submit" aria-label="Send" className="flex size-9 items-center justify-center rounded-lg bg-chalk-400 text-baize-950 transition hover:bg-chalk-300">
            <Send className="size-4" />
          </button>
        </form>
      )}
    </div>
  )
}
