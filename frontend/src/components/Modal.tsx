import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Modal({ open, onClose, children, width = 'max-w-md', label }: { open: boolean; onClose: () => void; children: ReactNode; width?: string; label: string }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-baize-950/70 backdrop-blur-[3px]" onClick={onClose} />
      <div className={`relative w-full ${width} animate-pop rounded-[22px] bg-baize-850 p-7 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_40px_80px_-20px_rgb(0_0_0/0.85)]`}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-lg p-1.5 text-baize-400 transition hover:bg-white/5 hover:text-baize-100">
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}
