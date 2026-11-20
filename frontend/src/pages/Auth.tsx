import { UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { getGoogleAuthUrl } from '../lib/api'

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

export default function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const { user, login, signup, playAsGuest } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(params.get('error'))
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
          <p className="mt-3 text-[15px] text-ink-400">{isSignup ? 'Create an account to keep your rating and history.' : 'Sign in to continue playing.'}</p>
        </div>
        <Card className="p-6">
          {user?.isGuest && isSignup && (
            <div className="mb-4 rounded-xl bg-ink-800 p-3 text-[13px] text-ink-300">
              You're playing as <b>{user.username}</b>. A new account starts fresh at 1200.
            </div>
          )}

          <a
            href={getGoogleAuthUrl()}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-ink-100 transition hover:bg-white/10 hover:border-white/20"
          >
            <svg className="size-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.17 0 9.99 0 12s.45 3.83 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            Continue with Google
          </a>

          <div className="my-5 flex items-center gap-3 text-xs text-ink-500">
            <div className="h-px flex-1 bg-white/8" /> or with username <div className="h-px flex-1 bg-white/8" />
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Username" value={username} onChange={setUsername} autoComplete="username" autoFocus />
            <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete={isSignup ? 'new-password' : 'current-password'} />

            {!isSignup && (
              <div className="flex justify-end">
                <Link to="/forgot-password" className="text-xs text-ink-400 hover:text-ink-200 hover:underline">
                  Forgot password?
                </Link>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-red-200 ring-1 ring-loss/25">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === 'form'} disabled={!username || !password}>
              {isSignup ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-ink-500">
            <div className="h-px flex-1 bg-white/8" /> or <div className="h-px flex-1 bg-white/8" />
          </div>
          <Button className="w-full" loading={busy === 'guest'} onClick={() => run('guest', playAsGuest)}>
            <UserRound className="size-4" /> Continue as guest
          </Button>
        </Card>
        <p className="mt-6 text-sm text-ink-400">
          {isSignup ? 'Already have an account?' : 'New to Gambit?'}{' '}
          <Link to={`${isSignup ? '/login' : '/signup'}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-ink-100 underline underline-offset-4">
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
      <span className="mb-1.5 block text-sm font-medium text-ink-300">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="felt-sunk h-12 w-full rounded-xl px-4 text-[16px] transition placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-accent-400/70"
      />
    </label>
  )
}
