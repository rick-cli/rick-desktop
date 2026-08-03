import { Component, StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './index.css'
import App from './App'
import { NotificationsProvider } from './components/Notifications'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  message?: string
}

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {}

  static getDerivedStateFromError(cause: unknown): AppErrorBoundaryState {
    return { message: cause instanceof Error ? cause.message : 'Unexpected application error' }
  }

  render() {
    if (this.state.message) {
      return (
        <div className="boot-error" role="alert">
          <div className="boot-error__mark">!</div>
          <h1>Rick Desktop couldn’t load</h1>
          <p>{this.state.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <NotificationsProvider>
        <App />
      </NotificationsProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
