import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startDeviceHoldTracking } from './lib/deviceOrientation'
import './ui-polish.css'
import './ios-safe-area.css'
import './phone-landscape.css'
import './detection-rotation.css'

startDeviceHoldTracking()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
