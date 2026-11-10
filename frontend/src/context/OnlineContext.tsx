import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { wsUrl } from '../lib/api'
import { playSound, soundForSan } from '../lib/sound'
import type { ChatLine, Clocks, Color, GameResult, GameView, Room, WireMove } from '../lib/types'
import { useAuth } from './AuthContext'

export interface LiveGame extends GameView {
  /** performance.now() when `clocks` was received — clocks tick down locally from here */
  clocksAt: number
  /** performance.now() deadline at which a disconnected player forfeits */
  abandonAt: Record<Color, number | null>
  pgn?: string
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

type ConnStatus = 'offline' | 'connecting' | 'online'

interface OnlineValue {
  status: ConnStatus
  queuedFor: string | null
  room: Room | null
  games: Record<string, LiveGame>
  missing: Record<string, boolean>
  toasts: Toast[]
  send: (msg: Record<string, unknown>) => boolean
  move: (gameId: string, move: Omit<WireMove, 'san'>, san: string) => void
  notify: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

const OnlineContext = createContext<OnlineValue | null>(null)
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
const PING_MS = 15_000

const deadline = (ms: number | null, now: number) => (ms === null ? null : now + ms)
const withTimes = (prev: LiveGame | undefined, game: GameView, now: number): LiveGame => ({
  ...prev,
  ...game,
  clocksAt: now,
  abandonAt: { white: deadline(game.abandonMs.white, now), black: deadline(game.abandonMs.black, now) },
})

type ServerMsg = { type: string; gameId?: string; [k: string]: unknown }

export function OnlineProvider({ children }: { children: ReactNode }) {
  const { token, refresh, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [status, setStatus] = useState<ConnStatus>('offline')
  const [queuedFor, setQueuedFor] = useState<string | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [games, setGames] = useState<Record<string, LiveGame>>({})
  const [missing, setMissing] = useState<Record<string, boolean>>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname
  const gamesRef = useRef(games)
  gamesRef.current = games

  const notify = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(msg))
    return true
  }, [])

  const patchGame = useCallback((id: string, fn: (g: LiveGame) => LiveGame) => {
    setGames((all) => (all[id] ? { ...all, [id]: fn(all[id]) } : all))
  }, [])

  const handle = useCallback(
    (msg: ServerMsg) => {
      const now = performance.now()
      const id = msg.gameId
      switch (msg.type) {
        case 'hello':
        case 'lobby':
          setQueuedFor((msg.queuedFor as string | null) ?? null)
          setRoom((msg.room as Room | null) ?? null)
          return
        case 'game_state': {
          const game = msg.game as GameView
          const isNew = !gamesRef.current[game.id]
          setGames((all) => ({ ...all, [game.id]: withTimes(all[game.id], game, now) }))
          if (game.you && game.status === 'active') {
            setQueuedFor(null)
            setRoom(null)
            if (isNew && game.moves.length === 0) playSound('start')
            const target = `/play/${game.id}`
            if (pathRef.current !== target) navigate(target)
          }
          return
        }
        case 'move': {
          const m = msg.move as WireMove
          const ply = msg.ply as number
          const g = id ? gamesRef.current[id] : undefined
          if (!g || !id) return
          if (g.moves.length === ply - 1) {
            playSound(soundForSan(m.san))
          } else if (!(g.moves.length >= ply && g.moves[ply - 1]?.san === m.san)) {
            // out of sync (missed a message) — ask for a fresh snapshot
            send({ type: 'spectate', gameId: id })
            return
          }
          patchGame(id, (cur) => ({
            ...cur,
            moves: cur.moves.length === ply - 1 ? [...cur.moves, m] : cur.moves,
            clocks: msg.clocks as Clocks,
            clocksAt: now,
            drawOfferFrom: msg.drawOfferFrom as Color | null,
          }))
          return
        }
        case 'game_over':
          if (!id) return
          playSound('end')
          patchGame(id, (g) => ({
            ...g,
            status: 'finished',
            result: msg.result as GameResult,
            clocks: msg.clocks as Clocks,
            clocksAt: now,
            pgn: msg.pgn as string,
            drawOfferFrom: null,
          }))
          return
        case 'draw_offer': {
          if (!id) return
          const from = msg.from as Color | null
          const g = gamesRef.current[id]
          if (from && g?.you && from !== g.you) playSound('notify')
          if (!from && msg.declinedBy && g?.you && msg.declinedBy !== g.you) notify('Draw offer declined')
          patchGame(id, (cur) => ({ ...cur, drawOfferFrom: from }))
          return
        }
        case 'rematch': {
          if (!id) return
          const from = msg.from as Color | null
          const g = gamesRef.current[id]
          if (from && g?.you && from !== g.you) playSound('notify')
          if (!from && msg.declinedBy && g?.you && msg.declinedBy !== g.you) notify('Rematch declined')
          patchGame(id, (cur) => ({ ...cur, rematchFrom: from }))
          return
        }
        case 'chat':
          if (!id) return
          patchGame(id, (g) => ({ ...g, chat: [...g.chat, msg.line as ChatLine].slice(-50) }))
          return
        case 'presence':
          if (!id) return
          patchGame(id, (g) => ({
            ...g,
            connected: { ...g.connected, [msg.color as Color]: msg.connected as boolean },
            abandonAt: { ...g.abandonAt, [msg.color as Color]: msg.abandonMs === null ? null : now + (msg.abandonMs as number) },
          }))
          return
        case 'spectators':
          if (!id) return
          patchGame(id, (g) => ({ ...g, spectators: msg.count as number }))
          return
        case 'move_rejected': {
          const game = msg.game as GameView
          playSound('illegal')
          if (msg.reason !== 'Illegal move') notify(String(msg.reason), 'error')
          setGames((all) => ({ ...all, [game.id]: withTimes(all[game.id], game, now) }))
          return
        }
        case 'spectate_missing':
          if (id) setMissing((m) => ({ ...m, [id]: true }))
          return
        case 'error':
          notify(String(msg.message), 'error')
          return
      }
    },
    [navigate, notify, patchGame, send],
  )

  const handleRef = useRef(handle)
  handleRef.current = handle

  useEffect(() => {
    if (!token || !user) {
      setStatus('offline')
      return
    }
    let attempt = 0
    let stopped = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined

    const open = () => {
      setStatus('connecting')
      const ws = new WebSocket(wsUrl(token))
      wsRef.current = ws
      ws.onopen = () => {
        attempt = 0
        setStatus('online')
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping', t: Date.now() })), PING_MS)
        // re-sync every game we are looking at (spectated games need re-subscribing after a reconnect)
        for (const g of Object.values(gamesRef.current)) {
          if (g.status === 'active') ws.send(JSON.stringify({ type: 'spectate', gameId: g.id }))
        }
      }
      ws.onmessage = (e) => {
        try {
          handleRef.current(JSON.parse(String(e.data)) as ServerMsg)
        } catch {
          /* ignore malformed frames */
        }
      }
      ws.onclose = () => {
        clearInterval(pingTimer)
        if (wsRef.current === ws) wsRef.current = null
        if (stopped) return
        setStatus('connecting')
        // a stale/invalid token makes every upgrade fail — let auth find out and log us out
        if (attempt >= 2) void refresh()
        retryTimer = setTimeout(open, BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)])
      }
    }
    open()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      wsRef.current?.close()
      wsRef.current = null
      setStatus('offline')
    }
  }, [token, user?.id, refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  const move = useCallback(
    (gameId: string, mv: Omit<WireMove, 'san'>, san: string) => {
      const g = gamesRef.current[gameId]
      if (!g || !send({ type: 'move', gameId, move: mv })) {
        notify('Connection lost — reconnecting…', 'error')
        return
      }
      // optimistic: show the move immediately, server echo confirms it
      playSound(soundForSan(san))
      const elapsed = g.clocks.ticking ? performance.now() - g.clocksAt : 0
      patchGame(gameId, (cur) => ({
        ...cur,
        moves: [...cur.moves, { ...mv, san }],
        clocks: cur.clocks.ticking
          ? { ...cur.clocks, [cur.clocks.ticking]: cur.clocks[cur.clocks.ticking] - elapsed, ticking: null }
          : cur.clocks,
        clocksAt: performance.now(),
      }))
    },
    [notify, patchGame, send],
  )

  const value = useMemo<OnlineValue>(
    () => ({ status, queuedFor, room, games, missing, toasts, send, move, notify, dismiss }),
    [status, queuedFor, room, games, missing, toasts, send, move, notify, dismiss],
  )
  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>
}

export function useOnline(): OnlineValue {
  const ctx = useContext(OnlineContext)
  if (!ctx) throw new Error('useOnline must be used inside OnlineProvider')
  return ctx
}
