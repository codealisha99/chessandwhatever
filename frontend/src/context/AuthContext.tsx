import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, tokenStore } from '../lib/api'
import type { User } from '../lib/types'

interface Session {
  token: string
  user: User
}

interface AuthValue {
  user: User | null
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  signup: (username: string, password: string) => Promise<void>
  playAsGuest: () => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
  refresh: () => Promise<void>
  setAuthToken: (token: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => tokenStore.get())
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(token))

  const adopt = useCallback((s: Session) => {
    tokenStore.set(s.token)
    setToken(s.token)
    setUser(s.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      if (tokenStore.get()) {
        await api('/auth/logout', { method: 'POST' })
      }
    } catch {
      /* ignore server failure on logout */
    } finally {
      tokenStore.clear()
      setToken(null)
      setUser(null)
    }
  }, [])

  const logoutAll = useCallback(async () => {
    try {
      if (tokenStore.get()) {
        await api('/auth/logout-all', { method: 'POST' })
      }
    } catch {
      /* ignore */
    } finally {
      tokenStore.clear()
      setToken(null)
      setUser(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) return
    try {
      setUser(await api<User>('/me'))
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        tokenStore.clear()
        setToken(null)
        setUser(null)
      }
    }
  }, [])

  const setAuthToken = useCallback(async (newToken: string) => {
    tokenStore.set(newToken)
    setToken(newToken)
    try {
      const u = await api<User>('/me')
      setUser(u)
    } catch {
      tokenStore.clear()
      setToken(null)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    refresh().finally(() => setLoading(false))
    // only on boot; later refreshes are explicit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      token,
      loading,
      login: async (username, password) => adopt(await api<Session>('/auth/login', { body: { username, password } })),
      signup: async (username, password) => adopt(await api<Session>('/auth/signup', { body: { username, password } })),
      playAsGuest: async () => adopt(await api<Session>('/auth/guest', { method: 'POST', body: {} })),
      logout,
      logoutAll,
      refresh,
      setAuthToken,
    }),
    [user, token, loading, adopt, logout, logoutAll, refresh, setAuthToken],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
