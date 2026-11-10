const TOKEN_KEY = 'gambit.token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * API origin. Production points straight at the game server (VITE_API_URL) instead of going through a
 * Vercel rewrite: behind a rewrite the server only sees Vercel's IPs, which defeats per-client rate limits.
 * Empty = same-origin (Vite dev proxy, or the server serving the SPA itself).
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = tokenStore.get()
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(0, "Can't reach the server. Is it running?")
  }
  const json = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: string } | null
  if (!res.ok || !json?.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`)
  return json.data as T
}

/**
 * WebSocket endpoint. Static hosts like Vercel can't proxy WebSockets, so production builds point
 * straight at the game server via VITE_WS_URL (e.g. wss://gambit-server-production.up.railway.app/ws).
 * Without it we use same-origin /ws (Vite dev proxy, or the server serving the SPA itself).
 */
export function wsUrl(token: string): string {
  const base = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  return `${base}?token=${encodeURIComponent(token)}`
}
