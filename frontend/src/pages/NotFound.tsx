import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8">
      <div className="display text-[clamp(5rem,16vw,12rem)] text-baize-700">404</div>
      <h1 className="mt-4 text-2xl font-semibold">There's nothing on this square</h1>
      <p className="mt-2 max-w-md text-baize-400">The link may be mistyped, or the page has been removed.</p>
      <Link to="/" className="mt-8 inline-flex h-10 items-center rounded-[10px] bg-chalk-400 px-4 text-sm font-semibold text-baize-950 hover:bg-chalk-200">
        Go to the lobby
      </Link>
    </div>
  )
}
