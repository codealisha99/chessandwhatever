import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setSoundEnabled } from '../lib/sound'

export const BOARD_THEMES = {
  walnut: { name: 'Walnut', light: '#ecd6b0', dark: '#b07f55', lastMove: 'rgb(232 182 90 / 0.5)' },
  green: { name: 'Tournament', light: '#ebecd0', dark: '#739552', lastMove: 'rgb(245 246 130 / 0.55)' },
  slate: { name: 'Slate', light: '#dfe3e8', dark: '#7d8fa3', lastMove: 'rgb(155 199 255 / 0.5)' },
  midnight: { name: 'Midnight', light: '#c3c9d6', dark: '#4b5675', lastMove: 'rgb(140 170 255 / 0.45)' },
  coral: { name: 'Coral', light: '#f3e1d4', dark: '#d07e6a', lastMove: 'rgb(255 214 120 / 0.55)' },
  marble: { name: 'Marble', light: '#e9e6e1', dark: '#a39a8d', lastMove: 'rgb(232 182 90 / 0.5)' },
} as const

export type BoardTheme = keyof typeof BOARD_THEMES

export interface Settings {
  boardTheme: BoardTheme
  sound: boolean
  coordinates: boolean
  showLegalMoves: boolean
  animate: boolean
  autoQueen: boolean
  confirmResign: boolean
}

const DEFAULTS: Settings = {
  boardTheme: 'walnut',
  sound: true,
  coordinates: true,
  showLegalMoves: true,
  animate: true,
  autoQueen: false,
  confirmResign: true,
}

const KEY = 'gambit.settings'

function load(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    const merged = { ...DEFAULTS, ...parsed }
    return merged.boardTheme in BOARD_THEMES ? merged : { ...merged, boardTheme: DEFAULTS.boardTheme }
  } catch {
    return DEFAULTS
  }
}

interface SettingsValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings))
    setSoundEnabled(settings.sound)
  }, [settings])

  const value = useMemo(
    () => ({ settings, update: (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })) }),
    [settings],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
