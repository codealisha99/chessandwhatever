import { Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card } from '../components/ui'
import { api } from '../lib/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() },
      })
      setSubmitted(true)
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
          <h1 className="display text-6xl">Reset password</h1>
          <p className="mt-3 text-[15px] text-ink-400">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </div>

        <Card className="p-6">
          {submitted ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-500/10 text-accent-400">
                <Mail className="size-6" />
              </div>
              <h2 className="text-lg font-semibold text-ink-100">Check your email</h2>
              <p className="text-sm text-ink-300">
                If an account exists with <b>{email}</b>, we have sent instructions to reset your password.
              </p>
              <div className="pt-2">
                <Link to="/login" className="inline-block text-sm font-semibold text-accent-400 hover:underline">
                  Return to sign in
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink-300">Email address</span>
                <input
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="felt-sunk h-12 w-full rounded-xl px-4 text-[16px] transition placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-accent-400/70"
                  placeholder="you@example.com"
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
                disabled={!email || !email.includes('@')}
              >
                Send reset link
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
