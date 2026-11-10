export interface TimeControlOption {
  id: string
  label: string
  category: 'Bullet' | 'Blitz' | 'Rapid' | 'Classical'
}

const category = (minutes: number, inc: number): TimeControlOption['category'] => {
  const est = minutes * 60 + inc * 40
  return est < 180 ? 'Bullet' : est < 480 ? 'Blitz' : est < 1500 ? 'Rapid' : 'Classical'
}

// Must match TIME_CONTROLS in backend1/src/protocol.ts
export const TIME_CONTROLS: TimeControlOption[] = [
  '1+0', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '10+5', '15+10', '30+0', '30+20',
].map((id) => {
  const [m, i] = id.split('+').map(Number) as [number, number]
  return { id, label: `${m} + ${i}`, category: category(m, i) }
})

export const tcCategory = (id: string) => TIME_CONTROLS.find((t) => t.id === id)?.category ?? 'Rapid'

