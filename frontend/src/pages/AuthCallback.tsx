import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

export default function AuthCallback() {
  const [params] = useSearchParams()
  const { setAuthToken } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = params.get('code')
    const err = params.get('error')

    if (err) {
      setError(err)
      return
    }

    if (code) {
      api<{ token: string }>('/auth/exchange', {
        method: 'POST',
        body: { code },
      })
        .then((data) => setAuthToken(data.token))
        .then(() => {
          navigate('/', { replace: true })
        })
        .catch((e: Error) => {
          setError(e.message || 'Failed to exchange authorization code.')
        })
      return
    }

    setError('No authorization code received.')
  }, [params, setAuthToken, navigate])

  if (error) {
    return <Navigate to={`/login?error=${encodeURIComponent(error)}`} replace />
  }

  return (
    <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-ink-300">
        <Spinner className="size-8" />
        <p className="text-sm">Completing sign in…</p>
      </div>
    </div>
  )
}
