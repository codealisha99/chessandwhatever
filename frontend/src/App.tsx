import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { AuthProvider } from './context/AuthContext'
import { OnlineProvider } from './context/OnlineContext'
import { SettingsProvider } from './context/SettingsContext'
import Home from './pages/Home'

const Auth = lazy(() => import('./pages/Auth'))
const LiveGame = lazy(() => import('./pages/LiveGame'))
const Join = lazy(() => import('./pages/Join'))
const Computer = lazy(() => import('./pages/Computer'))
const ArchivedGame = lazy(() => import('./pages/Analysis').then((m) => ({ default: m.ArchivedGame })))
const FreeAnalysis = lazy(() => import('./pages/Analysis').then((m) => ({ default: m.FreeAnalysis })))
const Watch = lazy(() => import('./pages/Watch'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const Profile = lazy(() => import('./pages/Profile'))
const NotFound = lazy(() => import('./pages/NotFound'))

export default function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <AuthProvider>
          <OnlineProvider>
            <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Spinner className="size-8" /></div>}>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="login" element={<Auth mode="login" />} />
                  <Route path="signup" element={<Auth mode="signup" />} />
                  <Route path="play/:id" element={<LiveGame />} />
                  <Route path="join/:code" element={<Join />} />
                  <Route path="computer" element={<Computer />} />
                  <Route path="analysis" element={<FreeAnalysis />} />
                  <Route path="game/:id" element={<ArchivedGame />} />
                  <Route path="watch" element={<Watch />} />
                  <Route path="leaderboard" element={<Leaderboard />} />
                  <Route path="u/:username" element={<Profile />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </OnlineProvider>
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  )
}
