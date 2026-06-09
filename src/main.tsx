import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design-system.css'
import './editor-panel.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
