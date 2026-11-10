import { Chess } from 'chess.js'
import { Copy, Cpu, Download, FlipVertical2, Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Board, type BoardMove } from '../components/Board'
import { EvalBar } from '../components/EvalBar'
import { MoveList } from '../components/MoveList'
import { PlayerStrip } from '../components/PlayerStrip'
import { Button, Card, EmptyState, Spinner } from '../components/ui'
import { useOnline } from '../context/OnlineContext'
import { api } from '../lib/api'
import { downloadPgn, formatClock, material, opposite, replay, START_FEN, uciToMove } from '../lib/chess'
import { Engine, formatEval, type EngineLine } from '../lib/engine'
import { tcCategory } from '../lib/timeControls'
import type { Color, GameRecord } from '../lib/types'

interface Side {
  name: string
  rating?: number
  delta?: number
  link?: boolean
}

interface Props {
  moves: BoardMove[]
  white: Side
  black: Side
  title: string
  subtitle?: string
  result?: string
  pgn?: string
  clocks?: number[]
}

const ANALYSIS_DEPTH = 18
const AUTOPLAY_MS = 900

/** /game/:id — a finished game from the archive */
export function ArchivedGame() {
  const { id = '' } = useParams()
  const [game, setGame] = useState<GameRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setGame(null)
    setError(null)
    api<GameRecord>(`/games/${id}`).then(setGame).catch((e: Error) => setError(e.message))
  }, [id])

  if (error) {
    return (
      <EmptyState icon={<Cpu className="size-6" />} title="Game not found">
        {error} <Link to="/" className="text-chalk-300">Back to the lobby</Link>
      </EmptyState>
    )
  }
  if (!game) return <div className="flex min-h-[60vh] items-center justify-center"><Spinner className="size-8" /></div>

  return (
    <Analysis
      key={game.id}
      moves={game.moves.map((m) => uciToMove(m.uci))}
      clocks={game.moves.map((m) => m.clock)}
      white={{ name: game.whiteName, rating: game.whiteRating, delta: game.whiteDelta, link: true }}
      black={{ name: game.blackName, rating: game.blackRating, delta: game.blackDelta, link: true }}
      title={`${tcCategory(game.tc)} ${game.tc.replace('+', ' + ')}, rated`}
      subtitle={new Date(game.endedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
      result={`${game.result.replace('1/2-1/2', '½–½')} by ${game.reason}`}
      pgn={game.pgn}
    />
  )
}

/** /analysis — free analysis board, optionally seeded with a game via router state */
export function FreeAnalysis() {
  const state = useLocation().state as { moves?: BoardMove[]; white?: string; black?: string } | null
  return (
    <Analysis
      moves={state?.moves ?? []}
      white={{ name: state?.white ?? 'White' }}
      black={{ name: state?.black ?? 'Black' }}
      title="Analysis board"
      subtitle="Move pieces freely to explore lines"
    />
  )
}

function Analysis({ moves: original, white, black, title, subtitle, result, pgn, clocks }: Props) {
  const { notify } = useOnline()
  const [line, setLine] = useState<BoardMove[]>(original)
  const [cursor, setCursor] = useState(original.length - 1)
  const [flipped, setFlipped] = useState(false)
  const [engineOn, setEngineOn] = useState(true)
  const [evalLine, setEvalLine] = useState<EngineLine | null>(null)
  const [autoplay, setAutoplay] = useState(false)
  const engineRef = useRef<Engine | null>(null)

  const plies = useMemo(() => replay(line), [line])
  const fen = cursor >= 0 ? plies[cursor]?.fen ?? START_FEN : START_FEN
  const deviated = line.length !== original.length || line.some((m, i) => m.from !== original[i]?.from || m.to !== original[i]?.to)
  const bottom: Color = flipped ? 'black' : 'white'
  const mat = material(fen)
  const terminal = useMemo(() => new Chess(fen).isGameOver(), [fen])
  // decided positions: fill the bar for the side that delivered mate, centre it for draws
  const finalLine = useMemo<EngineLine | null>(() => {
    if (!terminal) return null
    const c = new Chess(fen)
    if (!c.isCheckmate()) return { depth: 0, cp: 0, mate: null, pv: [] }
    return { depth: 0, cp: null, mate: c.turn() === 'w' ? -Infinity : Infinity, pv: [] }
  }, [fen, terminal])

  useEffect(() => {
    if (!engineOn) return
    try {
      engineRef.current = new Engine()
    } catch {
      notify('Could not start the engine in this browser', 'error')
      setEngineOn(false)
    }
    return () => {
      engineRef.current?.destroy()
      engineRef.current = null
    }
  }, [engineOn, notify])

  useEffect(() => {
    setEvalLine(null)
    const engine = engineRef.current
    if (!engineOn || !engine || terminal) return
    let stale = false
    const t = setTimeout(() => engine.analyse(fen, (l) => !stale && setEvalLine(l), ANALYSIS_DEPTH).catch(() => undefined), 120)
    return () => {
      stale = true
      clearTimeout(t)
      engine.stop()
    }
  }, [fen, engineOn, terminal])

  useEffect(() => {
    if (!autoplay) return
    if (cursor >= plies.length - 1) return setAutoplay(false)
    const t = setTimeout(() => setCursor((c) => c + 1), AUTOPLAY_MS)
    return () => clearTimeout(t)
  }, [autoplay, cursor, plies.length])

  const onMove = useCallback(
    (m: BoardMove) => {
      setLine((l) => {
        const next = l[cursor + 1]
        if (next && next.from === m.from && next.to === m.to && next.promotion === m.promotion) return l
        return [...l.slice(0, cursor + 1), m]
      })
      setCursor((c) => c + 1)
    },
    [cursor],
  )

  const pvSan = useMemo(() => {
    if (!evalLine?.pv.length) return []
    const c = new Chess(fen)
    const out: string[] = []
    for (const uci of evalLine.pv.slice(0, 8)) {
      try {
        out.push(c.move(uciToMove(uci)).san)
      } catch {
        break
      }
    }
    return out
  }, [evalLine, fen])

  const best = evalLine?.pv[0] ? [{ ...uciToMove(evalLine.pv[0]), color: 'rgb(127 191 106 / 0.8)' }] : []

  function exportPgn() {
    if (pgn && !deviated) return downloadPgn(pgn, `${white.name}_vs_${black.name}`)
    const c = new Chess()
    c.setHeader('White', white.name)
    c.setHeader('Black', black.name)
    for (const m of line) c.move(m)
    downloadPgn(c.pgn(), 'analysis')
  }

  const strip = (c: Color) => {
    const s = c === 'white' ? white : black
    // clock after this side's most recent move at or before the cursor
    let clock: number | undefined
    if (clocks && !deviated) {
      for (let i = cursor; i >= 0; i--) if ((i % 2 === 0) === (c === 'white')) { clock = clocks[i]; break }
    }
    return (
      <PlayerStrip
        name={s.name}
        rating={s.rating}
        delta={s.delta}
        link={s.link ?? false}
        color={c}
        captured={c === 'white' ? mat.byWhite : mat.byBlack}
        advantage={c === 'white' ? mat.balance : -mat.balance}
        right={clock !== undefined ? <span className="tabular rounded-lg bg-ink-800 px-3 py-1.5 digits text-lg text-ink-300">{formatClock(clock)}</span> : undefined}
      />
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-3 pb-10 pt-4 sm:px-6 lg:pt-6">
      <h1 className="sr-only">
        {white.link ? `${white.name} against ${black.name}: ${title}` : title}
      </h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,calc(100dvh-210px))_360px] lg:justify-center lg:gap-10">
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-250px))] min-w-[280px]">
          <div className="mb-3">{strip(opposite(bottom))}</div>
          <div className="flex gap-2.5">
            {engineOn && <EvalBar line={finalLine ?? evalLine} orientation={bottom} />}
            <div className="min-w-0 flex-1">
              <Board fen={fen} orientation={bottom} movable="both" lastMove={cursor >= 0 ? plies[cursor] : null} arrows={engineOn ? best : []} onMove={onMove} />
            </div>
          </div>
          <div className="mt-3">{strip(bottom)}</div>
        </div>

        <Card className="flex max-h-[calc(100dvh-110px)] min-h-[440px] flex-col overflow-hidden lg:sticky lg:top-20">
          <div className="border-b border-white/5 px-4 py-3">
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-ink-400">
              {subtitle}
              {result && `. ${result}`}
            </div>
          </div>

          <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={engineOn}
              onClick={() => setEngineOn((o) => !o)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold transition ${engineOn ? 'bg-win/15 text-win' : 'bg-ink-800 text-ink-400'}`}
            >
              <Cpu className="size-3.5" /> {engineOn ? 'Stockfish' : 'Engine off'}
            </button>
            {engineOn && (
              <div className="min-w-0 flex-1 text-xs">
                {terminal ? (
                  <span className="text-ink-400">{finalLine?.mate ? `Checkmate, ${finalLine.mate > 0 ? 'white' : 'black'} wins` : 'Game over, drawn'}</span>
                ) : evalLine ? (
                  <div className="flex items-center gap-2">
                    <span className="tabular digits font-bold text-ink-100">{formatEval(evalLine)}</span>
                    <span className="truncate text-ink-400" title={pvSan.join(' ')}>
                      {pvSan.join(' ')}
                    </span>
                    <span className="ml-auto shrink-0 text-ink-500">d{evalLine.depth}</span>
                  </div>
                ) : (
                  <span className="flex items-center gap-2 text-ink-400"><Spinner className="size-3" /> Analysing…</span>
                )}
              </div>
            )}
          </div>

          <MoveList sans={plies.map((p) => p.san)} cursor={cursor} onJump={setCursor} />

          <div className="grid grid-cols-4 gap-1.5 border-t border-white/5 p-3">
            <Button size="sm" onClick={() => (cursor >= plies.length - 1 && setCursor(-1), setAutoplay((a) => !a))} disabled={plies.length === 0} title="Autoplay">
              {autoplay ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Button size="sm" onClick={() => setFlipped((f) => !f)} title="Flip board">
              <FlipVertical2 className="size-4" />
            </Button>
            <Button
              size="sm"
              title="Copy FEN"
              onClick={() => navigator.clipboard.writeText(fen).then(() => notify('FEN copied'), () => notify('Could not copy', 'error'))}
            >
              <Copy className="size-4" />
            </Button>
            <Button size="sm" onClick={exportPgn} disabled={line.length === 0} title="Download PGN">
              <Download className="size-4" />
            </Button>
            {deviated && original.length > 0 && (
              <Button size="sm" variant="ghost" className="col-span-4" onClick={() => (setLine(original), setCursor(original.length - 1))}>
                <RotateCcw className="size-4" /> Back to game line
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
