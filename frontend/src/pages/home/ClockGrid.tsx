import { TIME_CONTROLS, type TimeControlOption } from '../../lib/timeControls'
import { ClockTile } from './ClockTile'

const CATEGORIES: TimeControlOption['category'][] = ['Bullet', 'Blitz', 'Rapid', 'Classical']
const CATEGORY_NOTE: Record<TimeControlOption['category'], string> = {
  Bullet: 'Under three minutes',
  Blitz: 'Three to eight',
  Rapid: 'Ten to twenty-five',
  Classical: 'Half an hour or more',
}

/** Every time control, grouped by speed. Picking one joins that pairing queue (or leaves it). */
export function ClockGrid({ searching, busy, waitingBy, onPick }: { searching: string | null; busy: boolean; waitingBy: Record<string, number>; onPick: (tc: string) => void }) {
  return (
    <div className="space-y-6">
      {CATEGORIES.map((cat) => (
        <div key={cat} className="grid gap-3 sm:grid-cols-[9rem_1fr] sm:items-center" role="group" aria-label={cat}>
          <div>
            <div className="text-[15px] font-semibold text-baize-200">{cat}</div>
            <div className="text-[13px] text-baize-500">{CATEGORY_NOTE[cat]}</div>
          </div>
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-4 pt-1.5 sm:grid-cols-4">
            {TIME_CONTROLS.filter((t) => t.category === cat).map((tc) => (
              <ClockTile
                key={tc.id}
                tc={tc}
                searching={searching === tc.id}
                disabled={busy}
                // you are in that queue yourself while searching; only count other people
                waiting={Math.max(0, (waitingBy[tc.id] ?? 0) - (searching === tc.id ? 1 : 0))}
                onClick={() => onPick(tc.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
