import { BOARD_THEMES, useSettings, type BoardTheme } from '../context/SettingsContext'
import { Modal } from './Modal'
import { Toggle } from './ui'

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useSettings()
  return (
    <Modal open={open} onClose={onClose} label="Settings">
      <h2 className="display text-4xl">Settings</h2>
      <div className="mt-6 text-sm font-semibold text-baize-300">Board</div>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((key) => {
          const t = BOARD_THEMES[key]
          const active = settings.boardTheme === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => update({ boardTheme: key })}
              className={`group rounded-xl p-1.5 text-left transition ${active ? 'bg-baize-700 ring-2 ring-chalk-400' : 'bg-baize-800 hover:bg-baize-700'}`}
            >
              <div className="grid aspect-[2/1] grid-cols-4 overflow-hidden rounded-lg">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} style={{ background: (i + Math.floor(i / 4)) % 2 === 0 ? t.light : t.dark }} />
                ))}
              </div>
              <div className={`mt-1.5 px-1 text-xs font-medium ${active ? 'text-baize-100' : 'text-baize-400'}`}>{t.name}</div>
            </button>
          )
        })}
      </div>
      <div className="mt-5 divide-y divide-white/5">
        <Toggle label="Sound effects" checked={settings.sound} onChange={(sound) => update({ sound })} />
        <Toggle label="Show legal moves" checked={settings.showLegalMoves} onChange={(showLegalMoves) => update({ showLegalMoves })} />
        <Toggle label="Board coordinates" checked={settings.coordinates} onChange={(coordinates) => update({ coordinates })} />
        <Toggle label="Piece animation" checked={settings.animate} onChange={(animate) => update({ animate })} />
        <Toggle label="Always promote to queen" checked={settings.autoQueen} onChange={(autoQueen) => update({ autoQueen })} />
        <Toggle label="Confirm before resigning" checked={settings.confirmResign} onChange={(confirmResign) => update({ confirmResign })} />
      </div>
    </Modal>
  )
}
