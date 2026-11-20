import { CheckCircle2, Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card } from '../components/ui'
import { api } from '../lib/api'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('Missing reset token. Please use the link sent to your email.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      })
      setSuccess(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="display text-6xl">New password</h1>
          <p className="mt-3 text-[15px] text-ink-400">Choose a strong password for your Gambit account.</p>
        </div>

        <Card className="p-6">
          {success ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="size-6" />
              </div>
              <h2 className="text-lg font-semibold text-ink-100">Password updated</h2>
              <p className="text-sm text-ink-300">
                Your password has been reset successfully. You can now sign in with your new password.
              </p>
              <div className="pt-2">
                <Link
                  to="/login"
                  className="inline-flex w-full items-center justify-center rounded-xl bg-accent-500 px-4 py-3 font-semibold text-ink-950 transition hover:bg-accent-400"
                >
                  Sign in
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {!token && (
                <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-red-200 ring-1 ring-loss/25">
                  No reset token found in link. Please check your email or request a new reset link.
                </p>
              )}

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink-300">New password</span>
                <input
                  type="password"
                  required
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="felt-sunk h-12 w-full rounded-xl px-4 text-[16px] transition placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-accent-400/70"
                  placeholder="At least 6 characters"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink-300">Confirm new password</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="felt-sunk h-12 w-full rounded-xl px-4 text-[16px] transition placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-accent-400/70"
                  placeholder="Repeat new password"
                />
              </label>

              {error && (
                <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-red-200 ring-1 ring-loss/25">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={loading}
                disabled={!token || !password || !confirmPassword}
              >
                <Lock className="size-4" /> Reset password
              </Button>
            </form>
          )}
        </Card>

        <p className="mt-6 text-sm text-ink-400">
          Remember your password?{' '}
          <Link to="/login" className="font-semibold text-ink-100 underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
