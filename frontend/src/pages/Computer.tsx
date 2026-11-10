import { Chess } from 'chess.js'
import { Bot, Flag, FlipVertical2, Lightbulb, LineChart, Play, RotateCcw, Undo2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Board, pieceUrl, type Arrow, type BoardMove } from '../components/Board'
import { Modal } from '../components/Modal'
import { MoveList } from '../components/MoveList'
import { PlayerStrip } from '../components/PlayerStrip'
import { Button, Card, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { BOT_LEVELS, Engine, type BotLevel } from '../lib/engine'
import { material, opposite, replay, START_FEN, uciToMove } from '../lib/chess'
import { playSound, soundForSan } from '../lib/sound'
import type { Color } from '../lib/types'

type Mode = 'bot' | 'local'
interface Setup {
  mode: Mode
  level: number
  color: Color
}
interface Saved extends Setup {
  moves: BoardMove[]
  resigned: Color | null
}

const STORAGE_KEY = 'gambit.offline'
const MIN_THINK_MS = 450

function loadSaved(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null
    return s && Array.isArray(s.moves) ? s : null
  } catch {
    return null
  }
}

function outcome(fen: string, resigned: Color | null): { headline: string; detail: string; winner: Color | null } | null {
  if (resigned) return { headline: `${resigned === 'white' ? 'Black' : 'White'} wins`, detail: 'by resignation', winner: opposite(resigned) }
  const c = new Chess(fen)
  if (c.isCheckmate()) {
    const winner: Color = c.turn() === 'w' ? 'black' : 'white'
    return { headline: `${winner === 'white' ? 'White' : 'Black'} wins`, detail: 'by checkmate', winner }
  }
  if (c.isStalemate()) return { headline: 'Draw', detail: 'by stalemate', winner: null }
  if (c.isInsufficientMaterial()) return { headline: 'Draw', detail: 'by insufficient material', winner: null }
  if (c.isThreefoldRepetition()) return { headline: 'Draw', detail: 'by threefold repetition', winner: null }
  if (c.isDrawByFiftyMoves()) return { headline: 'Draw', detail: 'by the fifty-move rule', winner: null }
  return null
}

export default function Computer() {
  const [game, setGame] = useState<Saved | null>(loadSaved)
  if (!game) return <SetupScreen onStart={(s) => setGame({ ...s, moves: [], resigned: null })} />
  return <OfflineGame key={`${game.mode}-${game.level}-${game.color}`} initial={game} onNew={() => (localStorage.removeItem(STORAGE_KEY), setGame(null))} />
}

/** What each level is like to play against, in a sentence. */
const LEVEL_NOTES = [
  'Moves almost at random. Good for learning how the pieces move.',
  'Looks one move ahead and leaves pieces hanging.',
  'Plays sensible openings, then misses tactics.',
  'Punishes loose pieces. A fair club opponent.',
  'Solid and patient. You will need a plan.',
  'Sharp tactics and few mistakes to feed on.',
  'Master strength. Expect to be outcalculated.',
  'Full engine strength. A draw is a good result.',
]

function SetupScreen({ onStart }: { onStart: (s: Setup) => void }) {
  const [mode, setMode] = useState<Mode>('bot')
  const [level, setLevel] = useState(3)
  const [color, setColor] = useState<Color | 'random'>('white')
  const lvl = BOT_LEVELS[level - 1]!
  const side: Color = mode === 'bot' && color === 'black' ? 'black' : 'white'
  return (
    <div className="mx-auto grid max-w-[1180px] items-center gap-x-20 gap-y-12 px-5 py-10 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <div>
        <h1 className="display animate-rise text-[clamp(4rem,9vw,6.5rem)]">Practice</h1>
        <p className="mt-4 max-w-md text-[16px] leading-relaxed text-baize-300">
          Unrated games against Stockfish, or against a friend on this screen. Take moves back, ask for a hint, and analyse afterwards.
        </p>

        <div className="felt-sunk mt-10 grid grid-cols-2 gap-1.5 rounded-2xl p-1.5" role="tablist">
          {([['bot', 'Against the computer', Bot], ['local', 'Pass and play', Users]] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${mode === m ? 'felt-raised text-baize-100' : 'text-baize-400 hover:text-baize-200'}`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        {mode === 'bot' ? (
          <>
            <div className="mt-8 flex items-end justify-between gap-4">
              <div>
                <div className="text-[13px] font-medium text-baize-400">Strength</div>
                <div className="mt-1 text-[1.7rem] font-bold leading-tight">
                  {lvl.name} <span className="digits text-lg font-semibold text-baize-500">{lvl.elo}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-8 gap-1.5">
              {BOT_LEVELS.map((l) => (
                <button
                  key={l.level}
                  type="button"
                  aria-label={`Level ${l.level}: ${l.name}`}
                  aria-pressed={l.level === level}
                  onClick={() => setLevel(l.level)}
                  className={`digits h-10 rounded-lg text-[15px] transition ${
                    l.level === level ? 'bg-chalk-400 text-baize-950 shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)]' : l.level < level ? 'bg-baize-600 text-baize-200' : 'felt-raised text-baize-400 hover:text-baize-100'
                  }`}
                >
                  {l.level}
                </button>
              ))}
            </div>
            <p className="annot mt-3 min-h-6 text-[16px] text-baize-300">{LEVEL_NOTES[level - 1]}</p>

            <div className="mt-7 text-[13px] font-medium text-baize-400">Play as</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['white', 'random', 'black'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold capitalize transition ${
                    color === c ? 'felt-raised text-baize-100 ring-2 ring-chalk-400' : 'felt-raised text-baize-400 hover:text-baize-100'
                  }`}
                >
                  {c !== 'random' && <img src={pieceUrl(c === 'white' ? 'wK' : 'bK')} alt="" className="size-6" />}
                  {c}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="annot mt-8 text-[16px] leading-relaxed text-baize-300">Two players share this screen and take turns. Flip the board whenever you like.</p>
        )}

        <Button
          variant="primary"
          size="lg"
          className="mt-9 w-full"
          onClick={() => onStart({ mode, level, color: color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color })}
        >
          <Play className="size-5" /> Start game
        </Button>
      </div>

      <figure className="mx-auto w-full max-w-[560px] animate-rise [animation-delay:120ms] max-lg:hidden">
        <div className="pointer-events-none">
          <Board fen={START_FEN} orientation={side} movable={null} />
        </div>
        <figcaption className="mt-5 flex items-center justify-between text-[13px] text-baize-400">
          <span>{mode === 'bot' ? `You play ${color === 'random' ? 'a random colour' : color}` : 'White moves first'}</span>
          <span>{mode === 'bot' ? `Stockfish 19, level ${lvl.level}` : 'Unrated'}</span>
        </figcaption>
      </figure>
    </div>
  )
}

function OfflineGame({ initial, onNew }: { initial: Saved; onNew: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { mode, color: you } = initial
  const level: BotLevel = BOT_LEVELS[initial.level - 1] ?? BOT_LEVELS[2]!
  const [moves, setMoves] = useState<BoardMove[]>(initial.moves)
  const [resigned, setResigned] = useState<Color | null>(initial.resigned)
  const [cursor, setCursor] = useState<number | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [hint, setHint] = useState<Arrow | null>(null)
  const [showResult, setShowResult] = useState(false)
  const engineRef = useRef<Engine | null>(null)
  const [engineError, setEngineError] = useState(false)

  const plies = useMemo(() => replay(moves), [moves])
  const lastIdx = plies.length - 1
  const shown = cursor === null ? lastIdx : cursor
  const fen = shown >= 0 ? plies[shown]!.fen : START_FEN
  const liveFen = lastIdx >= 0 ? plies[lastIdx]!.fen : START_FEN
  const turn: Color = plies.length % 2 === 0 ? 'white' : 'black'
  const over = outcome(liveFen, resigned)
  const live = cursor === null
  const bottom: Color = mode === 'local' ? (flipped ? 'black' : 'white') : flipped ? opposite(you) : you
  const mat = material(fen)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...initial, moves, resigned }))
  }, [initial, moves, resigned])

  useEffect(() => {
    if (mode !== 'bot') return
    try {
      engineRef.current = new Engine()
    } catch {
      setEngineError(true)
    }
    return () => engineRef.current?.destroy()
  }, [mode])

  const wasOver = useRef(Boolean(over))
  useEffect(() => {
    if (over && !wasOver.current) {
      setShowResult(true)
      playSound('end')
    }
    wasOver.current = Boolean(over)
  }, [over])

  // bot's turn
  const movesRef = useRef(moves)
  movesRef.current = moves
  useEffect(() => {
    const engine = engineRef.current
    if (mode !== 'bot' || over || turn === you || !engine) return
    const snapshot = moves.length
    const started = performance.now()
    setThinking(true)
    let cancelled = false
    engine
      .bestMove(liveFen, level)
      .then(async (uci) => {
        const wait = MIN_THINK_MS - (performance.now() - started)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        if (cancelled || !uci || movesRef.current.length !== snapshot) return
        const mv = uciToMove(uci)
        const san = new Chess(liveFen).move(mv).san
        playSound(soundForSan(san))
        setMoves((m) => [...m, mv.promotion ? mv : { from: mv.from, to: mv.to }])
      })
      .catch(() => setEngineError(true))
      .finally(() => !cancelled && setThinking(false))
    return () => {
      cancelled = true
      setThinking(false)
    }
  }, [mode, over, turn, you, liveFen, level, moves.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = useCallback((m: BoardMove, san: string) => {
    playSound(soundForSan(san))
    setHint(null)
    setMoves((all) => [...all, m])
  }, [])

  function takeBack() {
    setHint(null)
    setCursor(null)
    setResigned(null)
    engineRef.current?.stop()
    setMoves((m) => {
      if (mode === 'local') return m.slice(0, -1)
      // back to the last position where it's your move
      const drop = (m.length % 2 === 0) === (you === 'white') ? 2 : 1
      return m.slice(0, Math.max(0, m.length - drop))
    })
  }

  async function askHint() {
    const engine = engineRef.current
    if (!engine || over) return
    setHint(null)
    const uci = await engine.bestMove(liveFen, BOT_LEVELS[7]!)
    if (uci) setHint({ ...uciToMove(uci), color: 'rgb(127 191 106 / 0.85)' })
  }

  const playerName = user?.username ?? 'You'
  const names: Record<Color, string> =
    mode === 'local' ? { white: 'White', black: 'Black' } : you === 'white' ? { white: playerName, black: `Stockfish, ${level.name}` } : { white: `Stockfish, ${level.name}`, black: playerName }

  const strip = (c: Color) => (
    <PlayerStrip
      name={names[c]}
      link={false}
      color={c}
      captured={c === 'white' ? mat.byWhite : mat.byBlack}
      advantage={c === 'white' ? mat.balance : -mat.balance}
      active={!over && turn === c}
      right={mode === 'bot' && c !== you && thinking ? <span className="flex items-center gap-2 text-xs text-baize-400"><Spinner className="size-4" /> thinking</span> : undefined}
    />
  )

  const canInteract = !over && live && (mode === 'local' || turn === you) && !thinking

  return (
    <div className="mx-auto max-w-7xl px-3 pb-10 pt-4 sm:px-6 lg:pt-6">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,calc(100dvh-250px))_340px] lg:justify-center lg:gap-10">
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-250px))] min-w-[280px]">
          <div className="mb-3">{strip(opposite(bottom))}</div>
          <div className="relative">
            <Board
              fen={fen}
              orientation={bottom}
              movable={canInteract ? (mode === 'local' ? turn : you) : null}
              lastMove={shown >= 0 ? plies[shown] : null}
              arrows={hint && live ? [hint] : []}
              onMove={onMove}
            />
            {!live && (
              <button type="button" onClick={() => setCursor(null)} className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 animate-pop rounded-full bg-chalk-400 px-4 py-1.5 text-xs font-bold text-baize-950 shadow-xl">
                Back to current position
              </button>
            )}
          </div>
          <div className="mt-3">{strip(bottom)}</div>
        </div>

        <Card className="flex max-h-[calc(100dvh-110px)] min-h-[420px] flex-col overflow-hidden lg:sticky lg:top-20">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {mode === 'bot' ? <Bot className="size-4 text-chalk-400" /> : <Users className="size-4 text-chalk-400" />}
                {mode === 'bot' ? `Stockfish level ${level.level}` : 'Pass & play'}
              </div>
              <div className="text-xs text-baize-400">{mode === 'bot' ? `${level.name}, plays at ${level.elo.replace("~", "about ")}. Unrated.` : 'Two players, one board'}</div>
            </div>
            <button type="button" title="Flip board" aria-label="Flip board" onClick={() => setFlipped((f) => !f)} className="flex size-8 items-center justify-center rounded-lg text-baize-400 hover:bg-white/5 hover:text-baize-100">
              <FlipVertical2 className="size-4" />
            </button>
          </div>
          {engineError && <div className="bg-loss/10 px-4 py-2 text-xs text-red-200">The engine failed to load. Try reloading the page.</div>}
          <MoveList sans={plies.map((p) => p.san)} cursor={shown} onJump={(p) => setCursor(p >= lastIdx ? null : p)} footer={over ? `${over.headline} ${over.detail}` : undefined} />
          <div className="grid grid-cols-2 gap-2 border-t border-white/5 p-3">
            {over ? (
              <>
                <Button variant="primary" onClick={onNew}>
                  <RotateCcw className="size-4" /> New game
                </Button>
                <Button onClick={() => navigate('/analysis', { state: { moves, white: names.white, black: names.black } })}>
                  <LineChart className="size-4" /> Analyse
                </Button>
              </>
            ) : (
              <>
                <Button onClick={takeBack} disabled={moves.length === 0}>
                  <Undo2 className="size-4" /> Takeback
                </Button>
                {mode === 'bot' ? (
                  <Button onClick={askHint} disabled={!canInteract}>
                    <Lightbulb className="size-4" /> Hint
                  </Button>
                ) : (
                  <Button onClick={onNew}>
                    <RotateCcw className="size-4" /> Restart
                  </Button>
                )}
                <Button variant="ghost" className="col-span-2" onClick={() => setResigned(mode === 'local' ? turn : you)} disabled={moves.length === 0}>
                  <Flag className="size-4" /> Resign
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>

      <Modal open={showResult && !!over} onClose={() => setShowResult(false)} label="Game over">
        {over && (
          <div className="text-center">
            <h2 className="display text-5xl">
              {mode === 'bot' && over.winner ? (over.winner === you ? 'You won' : 'Stockfish wins') : over.headline}
            </h2>
            <p className="mt-1 text-baize-400">{over.detail}</p>
            <div className="mt-6 grid gap-2">
              <Button variant="primary" size="lg" onClick={onNew}>
                <RotateCcw className="size-4" /> New game
              </Button>
              <Button onClick={() => navigate('/analysis', { state: { moves, white: names.white, black: names.black } })}>
                <LineChart className="size-4" /> Analyse with Stockfish
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
