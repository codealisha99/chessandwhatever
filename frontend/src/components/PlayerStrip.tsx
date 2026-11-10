import { WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { pieceUrl } from './Board'
import { Avatar, Delta } from './ui'
import type { ReactNode } from 'react'

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

export function PlayerStrip({ name, rating, color, captured, advantage, link = true, delta, offline, right, active }: Props) {
  const enemy = color === 'white' ? 'b' : 'w'
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`rounded-xl transition ${active ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-ink-950' : ''}`}>
          <Avatar name={name} size={40} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            {link ? (
              <Link to={`/u/${name}`} className="truncate hover:text-gold-300">
                {name}
              </Link>
            ) : (
              <span className="truncate">{name}</span>
            )}
            {rating !== undefined && <span className="tabular font-normal text-ink-400">({rating})</span>}
            {delta !== undefined && delta !== null && (
              <span className="tabular text-sm font-semibold">
                <Delta value={delta} />
              </span>
            )}
          </div>
          <div className="flex h-5 items-center">
            {offline ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-loss">
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
                      className={`size-[18px] ${i > 0 && captured[i - 1] === t ? '-ml-2.5' : i > 0 ? '-ml-0.5' : ''}`}
                    />
                  ))}
                </div>
                {advantage > 0 && <span className="ml-1.5 text-xs font-semibold text-ink-400">+{advantage}</span>}
              </>
            )}
          </div>
        </div>
      </div>
      {right}
    </div>
  )
}
