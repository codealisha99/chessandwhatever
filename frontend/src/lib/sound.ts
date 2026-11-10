// Synthesised with Web Audio so there are no audio assets to ship.
export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'start' | 'end' | 'tick' | 'notify' | 'illegal'

let ctx: AudioContext | null = null
let enabled = true

export const setSoundEnabled = (on: boolean) => {
  enabled = on
}

function audio(): AudioContext | null {
  if (!enabled) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Short band-passed noise burst — reads as a piece landing on wood. */
function knock(c: AudioContext, at: number, freq: number, gain: number) {
  const len = Math.floor(c.sampleRate * 0.06)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4
  const src = c.createBufferSource()
  src.buffer = buf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = 1.4
  const g = c.createGain()
  g.gain.value = gain
  src.connect(bp).connect(g).connect(c.destination)
  src.start(at)
}

function tone(c: AudioContext, at: number, freq: number, dur: number, gain = 0.08, type: OscillatorType = 'sine') {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(c.destination)
  o.start(at)
  o.stop(at + dur + 0.02)
}

export function playSound(name: SoundName) {
  const c = audio()
  if (!c) return
  const t = c.currentTime + 0.005
  switch (name) {
    case 'move':
      return knock(c, t, 1800, 2.2)
    case 'capture':
      knock(c, t, 1300, 2.6)
      return knock(c, t + 0.045, 2200, 1.6)
    case 'castle':
      knock(c, t, 1700, 2)
      return knock(c, t + 0.09, 1900, 2)
    case 'check':
      knock(c, t, 1800, 2)
      return tone(c, t + 0.02, 880, 0.18, 0.05, 'triangle')
    case 'start':
      tone(c, t, 523.25, 0.22)
      return tone(c, t + 0.12, 783.99, 0.35)
    case 'end':
      tone(c, t, 659.25, 0.25)
      tone(c, t + 0.14, 523.25, 0.25)
      return tone(c, t + 0.28, 392, 0.5)
    case 'tick':
      return tone(c, t, 1200, 0.05, 0.03, 'square')
    case 'notify':
      return tone(c, t, 987.77, 0.2, 0.05)
    case 'illegal':
      return tone(c, t, 180, 0.12, 0.06, 'sawtooth')
  }
}

export function soundForSan(san: string): SoundName {
  if (san.includes('+') || san.includes('#')) return 'check'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}
