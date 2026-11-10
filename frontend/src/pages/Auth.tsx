import { UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card } from '../components/ui'
import { useAuth } from '../context/AuthContext'

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

export default function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const { user, login, signup, playAsGuest } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'form' | 'guest' | null>(null)
  const isSignup = mode === 'signup'

  if (user && !user.isGuest) return <Navigate to={next} replace />

  async function run(kind: 'form' | 'guest', fn: () => Promise<void>) {
    setError(null)
    setBusy(kind)
    try {
      await fn()
      navigate(next, { replace: true })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (isSignup && !USERNAME_RE.test(username.trim())) return setError('Username must be 3–20 letters, numbers or underscores.')
    if (isSignup && password.length < 6) return setError('Password must be at least 6 characters.')
    run('form', () => (isSignup ? signup(username.trim(), password) : login(username.trim(), password)))
  }

  return (
    <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="display text-6xl">{isSignup ? 'Join the board' : 'Welcome back'}</h1>
          <p className="mt-3 text-[15px] text-baize-400">{isSignup ? 'Create an account to keep your rating and history.' : 'Sign in to continue playing.'}</p>
        </div>
        <Card className="p-6">
          {user?.isGuest && isSignup && (
            <div className="mb-4 rounded-xl bg-baize-800 p-3 text-[13px] text-baize-300">
              You're playing as <b>{user.username}</b>. A new account starts fresh at 1200.
            </div>
          )}
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Username" value={username} onChange={setUsername} autoComplete="username" autoFocus />
            <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete={isSignup ? 'new-password' : 'current-password'} />
            {error && (
              <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-red-200 ring-1 ring-loss/25">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === 'form'} disabled={!username || !password}>
              {isSignup ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          <div className="my-5 flex items-center gap-3 text-xs text-baize-500">
            <div className="h-px flex-1 bg-white/8" /> or <div className="h-px flex-1 bg-white/8" />
          </div>
          <Button className="w-full" loading={busy === 'guest'} onClick={() => run('guest', playAsGuest)}>
            <UserRound className="size-4" /> Continue as guest
          </Button>
        </Card>
        <p className="mt-6 text-sm text-baize-400">
          {isSignup ? 'Already have an account?' : 'New to Gambit?'}{' '}
          <Link to={`${isSignup ? '/login' : '/signup'}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-baize-100 underline underline-offset-4">
            {isSignup ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', autoComplete, autoFocus }: { label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-baize-300">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-xl bg-baize-950/50 px-4 text-[16px] shadow-[inset_0_2px_4px_rgb(0_0_0/0.3)] transition placeholder:text-baize-500 focus:outline-none focus:ring-2 focus:ring-chalk-400/60"
      />
    </label>
  )
}
