import { Crown, Eye, LogOut, Menu, Settings, Swords, Trophy, User as UserIcon, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../context/OnlineContext'
import { SettingsModal } from './SettingsModal'
import { Avatar } from './ui'

const NAV = [
  { to: '/', label: 'Play', icon: Swords, end: true },
  { to: '/watch', label: 'Watch', icon: Eye },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
]

export function Logo() {
  return (
    <Link to="/" className="group flex items-center gap-2.5">
      <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 text-ink-950 shadow-[0_6px_20px_-6px_rgb(232_182_90/0.7)] transition group-hover:rotate-[-6deg]">
        <Crown className="size-5" strokeWidth={2.4} />
      </div>
      <span className="font-display text-[1.7rem] leading-none tracking-tight">Gambit</span>
    </Link>
  )
}

export function Layout() {
  const { user, logout } = useAuth()
  const { status, toasts, dismiss } = useOnline()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()

  const navLinks = (onClick?: () => void) =>
    NAV.map(({ to, label, icon: Icon, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        onClick={onClick}
        className={({ isActive }) =>
          `flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${isActive ? 'bg-white/8 text-ink-100' : 'text-ink-400 hover:bg-white/4 hover:text-ink-100'}`
        }
      >
        <Icon className="size-4" />
        {label}
      </NavLink>
    ))

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-950/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Logo />
            <nav className="hidden items-center gap-1 md:flex">{navLinks()}</nav>
          </div>
          <div className="flex items-center gap-2">
            {user && status !== 'online' && (
              <span className="hidden items-center gap-2 rounded-full bg-gold-400/10 px-3 py-1 text-xs font-medium text-gold-300 sm:flex">
                <span className="size-1.5 animate-pulse rounded-full bg-gold-400" /> Connecting…
              </span>
            )}
            <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings className="size-[18px]" />
            </IconButton>
            {user ? (
              <div className="flex items-center gap-1">
                <Link to={`/u/${user.username}`} className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-3 transition hover:bg-white/5">
                  <Avatar name={user.username} size={32} />
                  <span className="hidden text-sm leading-tight sm:block">
                    <span className="block font-semibold">{user.username}</span>
                    <span className="tabular block text-xs text-ink-400">{user.rating}</span>
                  </span>
                </Link>
                <IconButton
                  label="Sign out"
                  onClick={() => {
                    logout()
                    navigate('/')
                  }}
                >
                  <LogOut className="size-[18px]" />
                </IconButton>
              </div>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <Link to="/login" className="rounded-xl px-3.5 py-2 text-sm font-medium text-ink-300 hover:text-ink-100">
                  Sign in
                </Link>
                <Link to="/signup" className="rounded-xl bg-ink-100 px-3.5 py-2 text-sm font-semibold text-ink-950 transition hover:bg-white">
                  Create account
                </Link>
              </div>
            )}
            <IconButton label="Menu" className="md:hidden" onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </IconButton>
          </div>
        </div>
        {menuOpen && (
          <nav className="flex flex-col gap-1 border-t border-white/5 px-4 py-3 md:hidden">
            {navLinks(() => setMenuOpen(false))}
            {!user && (
              <NavLink to="/login" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-ink-400">
                <UserIcon className="size-4" /> Sign in
              </NavLink>
            )}
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto animate-pop rounded-xl px-4 py-3 text-left text-sm font-medium shadow-2xl ring-1 backdrop-blur-xl ${
              t.tone === 'error' ? 'bg-loss/20 text-red-100 ring-loss/40' : 'bg-ink-800/95 text-ink-100 ring-white/10'
            }`}
          >
            {t.text}
          </button>
        ))}
      </div>
    </div>
  )
}

function IconButton({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex size-9 items-center justify-center rounded-xl text-ink-400 transition hover:bg-white/5 hover:text-ink-100 ${className}`}>
      {children}
    </button>
  )
}
