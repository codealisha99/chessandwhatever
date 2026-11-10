import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { pieceUrl } from '../../components/Board'
import { Button, Card } from '../../components/ui'
import type { Color } from '../../lib/types'

export function FriendInvite({
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
