import { Swords } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Card, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../context/OnlineContext'

/** /join/:code — invite links. Navigation to the game happens in OnlineContext once it starts. */
export default function Join() {
  const { code = '' } = useParams()
  const { user, playAsGuest } = useAuth()
  const { status, send, notify } = useOnline()
  const sent = useRef(false)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!user || status !== 'online' || sent.current) return
    sent.current = true
    send({ type: 'join_room', code })
    const t = setTimeout(() => setSlow(true), 3000)
    return () => clearTimeout(t)
  }, [user, status, code, send])

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm animate-fade-up p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gold-400/15 text-gold-300">
          <Swords className="size-7" />
        </div>
        <h1 className="mt-5 font-display text-4xl">You've been challenged</h1>
        <p className="mt-2 text-sm text-ink-400">
          Invite code <span className="font-mono tracking-[0.2em] text-gold-300">{code.toUpperCase()}</span>
        </p>
        {user ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-sm text-ink-400">
            {slow ? (
              <p className="text-ink-300">This invite has expired or was cancelled. Ask your friend for a new link.</p>
            ) : (
              <>
                <Spinner className="size-6" />
                Joining the game…
              </>
            )}
            <Link to="/" className="mt-2 text-xs text-ink-500 hover:text-ink-300">
              Back to lobby
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-2">
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
              Accept as guest
            </Button>
            <Link to={`/login?next=/join/${code}`} className="rounded-xl py-2.5 text-sm font-semibold text-ink-300 hover:text-ink-100">
              Sign in to accept
            </Link>
          </div>
        )}
      </Card>
    </div>
  )
}
