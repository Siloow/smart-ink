import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design-system.css'
import './editor-panel.css'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './ErrorBoundary.tsx'
import CrashScreen from './CrashScreen.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={({ error }) => (
        <CrashScreen
          title="Smart Ink hit a problem"
          body="Your scenes are saved. Reloading takes you back to your scene list."
          error={error}
          actions={[{ label: 'Reload', onClick: () => window.location.reload(), primary: true }]}
        />
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
