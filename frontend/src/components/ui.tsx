import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-[0_8px_24px_-8px_rgb(232_182_90/0.6),inset_0_1px_0_rgb(255_255_255/0.4)] hover:brightness-105',
  secondary: 'bg-ink-800 text-ink-100 ring-1 ring-inset ring-white/8 hover:bg-ink-700',
  ghost: 'text-ink-300 hover:bg-white/5 hover:text-ink-100',
  danger: 'bg-loss/15 text-loss ring-1 ring-inset ring-loss/30 hover:bg-loss/25',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sizes = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-13 px-6 text-base gap-2.5' }
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex cursor-pointer select-none items-center justify-center rounded-xl font-semibold transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ${VARIANTS[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl bg-ink-900/80 ring-1 ring-inset ring-white/6 shadow-[0_20px_50px_-30px_rgb(0_0_0/0.8)] backdrop-blur-sm ${className}`}>
      {children}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin text-gold-400 ${className}`} />
}

const AVATAR_HUES = [28, 42, 145, 200, 260, 330, 12, 90]

export function Avatar({ name, size = 36, online }: { name: string; size?: number; online?: boolean }) {
  const hue = AVATAR_HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_HUES.length]
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-xl font-bold text-white/95 ring-1 ring-inset ring-white/15"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${hue} 50% 26%))`,
          fontSize: size * 0.42,
        }}
      >
        {name.replace(/^Guest_/, 'G').slice(0, 1).toUpperCase()}
      </div>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-ink-900 ${online ? 'bg-win' : 'bg-ink-500'}`}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </div>
  )
}

export function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-ink-400">±0</span>
  return <span className={value > 0 ? 'text-win' : 'text-loss'}>{value > 0 ? `+${value}` : value}</span>
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div>
        {eyebrow && <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">{eyebrow}</div>}
        <h1 className="font-display text-5xl leading-none text-ink-100 md:text-6xl">{title}</h1>
      </div>
      {children}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-ink-800 text-ink-400 ring-1 ring-white/5">{icon}</div>
      <div className="text-lg font-semibold text-ink-200">{title}</div>
      {children && <div className="max-w-sm text-sm text-ink-400">{children}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2.5">
      <span>
        <span className="block text-sm font-medium text-ink-100">{label}</span>
        {hint && <span className="block text-xs text-ink-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-gold-500' : 'bg-ink-600'}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}
