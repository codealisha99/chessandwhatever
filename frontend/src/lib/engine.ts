// Thin UCI wrapper around the Stockfish 19 lite WASM build in /public/engine (GPLv3, see STOCKFISH-LICENSE.txt).
const ENGINE_URL = '/engine/stockfish-19-lite-single.js'

export interface EngineLine {
  depth: number
  /** centipawns from white's point of view (null when mate is set) */
  cp: number | null
  /** moves to mate from white's point of view (+ white mates, - black mates) */
  mate: number | null
  pv: string[]
}

interface Search {
  resolve: (best: string | null) => void
  onInfo?: (line: EngineLine) => void
  whiteToMove: boolean
}

export interface BotLevel {
  level: number
  name: string
  elo: string
  skill: number
  go: string
}

export const BOT_LEVELS: BotLevel[] = [
  { level: 1, name: 'Pawn', elo: '~400', skill: 0, go: 'depth 1' },
  { level: 2, name: 'Squire', elo: '~800', skill: 2, go: 'depth 2' },
  { level: 3, name: 'Knight', elo: '~1100', skill: 5, go: 'depth 4' },
  { level: 4, name: 'Bishop', elo: '~1400', skill: 8, go: 'depth 6' },
  { level: 5, name: 'Rook', elo: '~1700', skill: 11, go: 'depth 8' },
  { level: 6, name: 'Queen', elo: '~2000', skill: 14, go: 'depth 11' },
  { level: 7, name: 'King', elo: '~2400', skill: 18, go: 'depth 14' },
  { level: 8, name: 'Grandmaster', elo: '2800+', skill: 20, go: 'movetime 1500' },
]

export class Engine {
  private worker: Worker
  private ready: Promise<void>
  private current: Search | null = null
  /** chain so a new search only starts after the previous one has reported bestmove */
  private queue: Promise<unknown> = Promise.resolve()
  private onReady: (() => void) | null = null

  constructor() {
    this.worker = new Worker(ENGINE_URL)
    this.worker.onmessage = (e: MessageEvent<string>) => this.onLine(String(e.data))
    this.ready = new Promise((resolve, reject) => {
      this.onReady = resolve
      this.worker.onerror = () => reject(new Error('Stockfish failed to load'))
    })
    this.worker.postMessage('uci')
    this.worker.postMessage('isready')
  }

  private onLine(line: string) {
    if (line === 'readyok') {
      this.onReady?.()
      this.onReady = null
      return
    }
    const s = this.current
    if (!s) return
    if (line.startsWith('bestmove')) {
      this.current = null
      const best = line.split(' ')[1]
      s.resolve(best && best !== '(none)' ? best : null)
      return
    }
    if (s.onInfo && line.startsWith('info') && line.includes(' pv ') && !line.includes('upperbound') && !line.includes('lowerbound')) {
      const depth = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0)
      const cpM = / score cp (-?\d+)/.exec(line)
      const mateM = / score mate (-?\d+)/.exec(line)
      const sign = s.whiteToMove ? 1 : -1
      const pv = line.split(' pv ')[1]?.trim().split(' ') ?? []
      s.onInfo({
        depth,
        cp: cpM ? sign * Number(cpM[1]) : null,
        mate: mateM ? sign * Number(mateM[1]) : null,
        pv,
      })
    }
  }

  private search(fen: string, go: string, setup: string[], onInfo?: (l: EngineLine) => void): Promise<string | null> {
    this.stop()
    const run = this.queue.then(async () => {
      await this.ready
      await new Promise<void>((r) => {
        // wait until any in-flight search has drained
        const wait = () => (this.current ? setTimeout(wait, 10) : r())
        wait()
      })
      return new Promise<string | null>((resolve) => {
        this.current = { resolve, onInfo, whiteToMove: fen.split(' ')[1] !== 'b' }
        for (const cmd of setup) this.worker.postMessage(cmd)
        this.worker.postMessage(`position fen ${fen}`)
        this.worker.postMessage(`go ${go}`)
      })
    })
    this.queue = run.catch(() => null)
    return run
  }

  bestMove(fen: string, level: BotLevel): Promise<string | null> {
    return this.search(fen, level.go, [
      'setoption name MultiPV value 1',
      `setoption name Skill Level value ${level.skill}`,
    ])
  }

  analyse(fen: string, onInfo: (l: EngineLine) => void, depth = 18): Promise<string | null> {
    return this.search(fen, `depth ${depth}`, ['setoption name Skill Level value 20'], onInfo)
  }

  stop() {
    if (this.current) this.worker.postMessage('stop')
  }

  destroy() {
    this.worker.terminate()
  }
}

/** Win-probability style squash of an evaluation into 0..1 (white's share of the bar). */
export function evalToShare(line: Pick<EngineLine, 'cp' | 'mate'> | null): number {
  if (!line) return 0.5
  if (line.mate !== null) return line.mate > 0 ? 1 : line.mate < 0 ? 0 : 0.5
  const cp = line.cp ?? 0
  return 1 / (1 + Math.exp(-0.004 * cp))
}

export function formatEval(line: Pick<EngineLine, 'cp' | 'mate'> | null): string {
  if (!line) return '0.0'
  if (line.mate !== null) return Number.isFinite(line.mate) ? `${line.mate > 0 ? '' : '-'}M${Math.abs(line.mate)}` : line.mate > 0 ? '1-0' : '0-1'
  const v = (line.cp ?? 0) / 100
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`
}
