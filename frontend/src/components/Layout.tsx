import { LogOut, Menu, Settings, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../context/OnlineContext'
import { SettingsModal } from './SettingsModal'
import { Avatar } from './ui'

const NAV = [
  { to: '/', label: 'Play', end: true },
  { to: '/computer', label: 'Practice' },
  { to: '/watch', label: 'Watch' },
  { to: '/leaderboard', label: 'Rankings' },
]

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`wordmark text-[1.45rem] leading-none text-baize-100 transition-colors hover:text-chalk-200 ${className}`} aria-label="Gambit home">
      Gambit
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
    NAV.map(({ to, label, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        onClick={onClick}
        className={({ isActive }) =>
          `relative py-2 text-[15px] font-medium transition-colors ${
            isActive
              ? 'text-baize-100 after:absolute after:inset-x-0 after:-bottom-[17px] after:h-[2px] after:bg-chalk-400 max-md:after:hidden'
              : 'text-baize-400 hover:text-baize-100'
          }`
        }
      >
        {label}
      </NavLink>
    ))

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-baize-900/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-6 px-5 sm:px-8">
          <div className="flex items-center gap-10">
            <Logo />
            <nav className="hidden items-center gap-7 md:flex">{navLinks()}</nav>
          </div>
          <div className="flex items-center gap-1.5">
            {user && <ConnectionDot status={status} />}
            <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings className="size-[18px]" />
            </IconButton>
            {user ? (
              <>
                <Link to={`/u/${user.username}`} className="ml-1 flex items-center gap-3 rounded-xl py-1 pl-1 pr-3 transition-colors hover:bg-white/5">
                  <Avatar name={user.username} size={32} />
                  <span className="hidden text-sm leading-tight sm:block">
                    <span className="block font-semibold text-baize-100">{user.username}</span>
                    <span className="digits block text-[13px] text-baize-400">{user.rating}</span>
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
              </>
            ) : (
              <div className="hidden items-center gap-1 sm:flex">
                <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-baize-300 hover:text-baize-100">
                  Sign in
                </Link>
                <Link to="/signup" className="rounded-[10px] bg-chalk-400 px-4 py-2 text-sm font-semibold text-baize-950 transition-colors hover:bg-chalk-200">
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
          <nav className="flex flex-col gap-1 border-t border-white/5 px-5 py-3 md:hidden">
            {navLinks(() => setMenuOpen(false))}
            {!user && (
              <NavLink to="/login" onClick={() => setMenuOpen(false)} className="py-2 text-[15px] font-medium text-baize-400">
                Sign in
              </NavLink>
            )}
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mx-auto w-full max-w-[1320px] px-5 py-10 text-[13px] text-baize-500 sm:px-8">
        Gambit is free and open. Engine: Stockfish 19. Pieces: cburnett.
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto animate-pop rounded-xl px-4 py-3 text-left text-sm font-medium shadow-[0_20px_40px_-12px_rgb(0_0_0/0.6)] ${
              t.tone === 'error' ? 'bg-flag text-white' : 'bg-chalk-400 text-baize-950'
            }`}
          >
            {t.text}
          </button>
        ))}
      </div>
    </div>
  )
}

function ConnectionDot({ status }: { status: string }) {
  const online = status === 'online'
  return (
    <span className="mr-1 hidden items-center gap-2 px-2 text-[13px] text-baize-400 sm:flex" title={online ? 'Connected' : 'Reconnecting'}>
      <span className={`size-2 rounded-full ${online ? 'bg-win' : 'animate-pulse bg-flag'}`} />
      {online ? 'Connected' : 'Reconnecting'}
    </span>
  )
}

function IconButton({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex size-9 items-center justify-center rounded-lg text-baize-400 transition-colors hover:bg-white/5 hover:text-baize-100 ${className}`}>
      {children}
    </button>
  )
}
