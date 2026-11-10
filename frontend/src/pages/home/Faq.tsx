import { Plus } from 'lucide-react'

// Every answer describes behaviour the server or client actually enforces.
const FAQ: [string, string][] = [
  [
    'Do I need an account?',
    'No. Picking a clock creates a guest account with a 1200 rating on the spot. Create a named account to sign in on other devices and to be listed in the rankings.',
  ],
  [
    'What happens if my connection drops?',
    'You have sixty seconds to reconnect, and the game resumes exactly where it was. Your clock keeps running in the meantime. After sixty seconds the game is lost by abandonment.',
  ],
  [
    'How are ratings calculated?',
    'With the Elo system. Your first twenty games move your rating faster, so it settles quickly; from 2400 it moves more slowly. Aborted games are not rated.',
  ],
  [
    'Can I play a friend?',
    'Yes. Create an invite, choose the clock and your colour, and send the link or the six-character code. The game starts as soon as they open it, and it is rated.',
  ],
  [
    'Where does the engine run?',
    'Practice games and the analysis board use Stockfish 19 compiled to WebAssembly, running in your browser. Your analysis is not sent to the server.',
  ],
  [
    'Can I watch other games?',
    'Any game in progress can be followed live, with both clocks. Players see how many people are watching.',
  ],
]

export function Faq() {
  return (
    <section className="grid gap-x-20 gap-y-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="display text-[clamp(2.8rem,6vw,4.5rem)]">
        Before you sit down.
      </h2>
      <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-semibold text-ink-100 transition-colors hover:text-chalk-200 [&::-webkit-details-marker]:hidden">
              {q}
              <Plus className="size-5 shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-45" aria-hidden />
            </summary>
            <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-ink-300">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
