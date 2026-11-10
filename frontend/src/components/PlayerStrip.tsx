import { WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { pieceUrl } from './Board'
import { Delta } from './ui'

interface Props {
  name: string
  rating?: number | string
  color: 'white' | 'black'
  captured: string[]
  advantage: number
  link?: boolean
  delta?: number | null
  offline?: ReactNode
  right?: ReactNode
  active?: boolean
}

/** One side of the board: who plays this colour, what they've taken, and their clock. */
export function PlayerStrip({ name, rating, color, captured, advantage, link = true, delta, offline, right, active }: Props) {
  const enemy = color === 'white' ? 'b' : 'w'
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <span
          aria-label={`Plays ${color}`}
          className={`size-[18px] shrink-0 rounded-full transition-shadow ${
            color === 'white' ? 'bg-chalk-300 shadow-[inset_0_-2px_0_rgb(0_0_0/0.15)]' : 'bg-baize-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_0_0_1px_rgb(255_255_255/0.1)]'
          } ${active ? 'ring-[3px] ring-chalk-400/35 ring-offset-0' : ''}`}
        />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            {link ? (
              <Link to={`/u/${name}`} className="truncate text-[16px] font-semibold text-baize-100 hover:underline hover:underline-offset-4">
                {name}
              </Link>
            ) : (
              <span className="truncate text-[16px] font-semibold text-baize-100">{name}</span>
            )}
            {rating !== undefined && <span className="digits text-[15px] text-baize-400">{rating}</span>}
            {delta !== undefined && delta !== null && (
              <span className="digits text-[15px]">
                <Delta value={delta} />
              </span>
            )}
          </div>
          <div className="mt-0.5 flex h-5 items-center">
            {offline ? (
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-loss">
                <WifiOff className="size-3.5" /> {offline}
              </span>
            ) : (
              <>
                <div className="flex">
                  {captured.map((t, i) => (
                    <img
                      key={i}
                      src={pieceUrl(`${enemy}${t.toUpperCase()}`)}
                      alt=""
                      className={`size-[19px] ${i > 0 && captured[i - 1] === t ? '-ml-[11px]' : i > 0 ? '-ml-0.5' : ''}`}
                    />
                  ))}
                </div>
                {advantage > 0 && <span className="digits ml-1.5 text-[13px] text-baize-400">+{advantage}</span>}
              </>
            )}
          </div>
        </div>
      </div>
      {right}
    </div>
  )
}
