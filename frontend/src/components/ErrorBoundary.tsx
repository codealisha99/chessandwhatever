import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button, Card } from './ui'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <Card className="w-full max-w-md p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-flag-deep/20 text-flag">
              <AlertTriangle className="size-6" />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-ink-100">Something went wrong</h2>
            <p className="mt-2 text-sm text-ink-400">
              An unexpected display error occurred. You can reload the screen or return to the lobby.
            </p>
            {this.state.error?.message && (
              <div className="mt-4 rounded-lg bg-ink-950/60 p-3 text-left font-mono text-xs text-ink-400">
                {this.state.error.message}
              </div>
            )}
            <div className="mt-6 flex justify-center gap-3">
              <Button variant="primary" size="sm" onClick={this.handleReset}>
                <RefreshCw className="size-4" /> Try again
              </Button>
              <Button size="sm" onClick={() => (window.location.href = '/')}>
                Go to Lobby
              </Button>
            </div>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
