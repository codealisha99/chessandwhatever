import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="font-display text-[8rem] leading-none text-gold-400/80">404</div>
      <h1 className="mt-2 text-2xl font-bold">This square is empty</h1>
      <p className="mt-2 text-ink-400">The page you're looking for moved — or never existed.</p>
      <Link to="/" className="mt-6 rounded-xl bg-ink-100 px-5 py-2.5 font-semibold text-ink-950">
        Back to the board
      </Link>
    </div>
  )
}
