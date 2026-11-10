import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-chalk-400 text-ink-950 shadow-[inset_0_-2px_0_rgb(0_0_0/0.12),0_8px_20px_-10px_rgb(242_238_227/0.35)] hover:bg-chalk-200',
  secondary: 'felt-raised text-ink-100 hover:brightness-125',
  ghost: 'text-ink-300 hover:bg-white/5 hover:text-ink-100',
  danger: 'bg-flag-deep text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.15)] hover:brightness-110',
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
  const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg', md: 'h-10 px-4 text-sm gap-2 rounded-[10px]', lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl' }
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex cursor-pointer select-none items-center justify-center font-semibold transition-[background-color,transform,filter] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

/** A raised panel of felt. Use sparingly — most content sits directly on the table. */
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl bg-ink-850/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),inset_0_0_0_1px_rgb(255_255_255/0.04),0_30px_60px_-36px_rgb(0_0_0/0.85)] ${className}`}>
      {children}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin text-ink-300 ${className}`} />
}

/** Monogram on a felt tile. */
export function Avatar({ name, size = 36, online }: { name: string; size?: number; online?: boolean }) {
  const letter = name.startsWith('Guest_') ? 'G' : name.slice(0, 1).toUpperCase()
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="digits flex h-full w-full items-center justify-center rounded-[28%] bg-gradient-to-b from-ink-600 to-ink-700 text-ink-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_2px_6px_-2px_rgb(0_0_0/0.5)]"
        style={{ fontSize: size * 0.5 }}
      >
        {letter}
      </div>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-[3px] ring-ink-900 ${online ? 'bg-win' : 'bg-ink-500'}`}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </div>
  )
}

export function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-ink-400">±0</span>
  return <span className={value > 0 ? 'text-win' : 'text-loss'}>{value > 0 ? `+${value}` : `−${Math.abs(value)}`}</span>
}

export function PageHeader({ title, lede, children }: { title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        <h1 className="display text-6xl text-ink-100 md:text-7xl">{title}</h1>
        {lede && <p className="mt-3 text-[15px] leading-relaxed text-ink-400">{lede}</p>}
      </div>
      {children}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-6 py-14">
      <div className="text-ink-500">{icon}</div>
      <div className="text-lg font-semibold text-ink-200">{title}</div>
      {children && <div className="max-w-md text-sm leading-relaxed text-ink-400">{children}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium text-ink-100">{label}</span>
        {hint && <span className="block text-xs text-ink-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-chalk-400' : 'bg-ink-600'}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full shadow transition-all ${checked ? 'left-[22px] bg-ink-900' : 'left-0.5 bg-ink-300'}`} />
      </button>
    </label>
  )
}
