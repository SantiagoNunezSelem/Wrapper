import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from './components/TooltipProvider.tsx'
import { loadRecaptchaScript } from './lib/recaptcha.ts'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? 'missing-google-client-id'
const recaptchaSiteKeyV3 = import.meta.env.VITE_RECAPTCHA_SITE_KEY_V3 ?? ''

// Loaded as soon as the app opens — invisible, no widget, nothing for the user to see or
// do. `executeRecaptchaV3` (called later, at the actual login attempt) needs the script
// already in place to produce a token instantly instead of waiting on it mid-click.
void loadRecaptchaScript(recaptchaSiteKeyV3)

// Requisito de instalabilidad (junto con el manifest): sin esto, Chrome/Edge
// no ofrecen `beforeinstallprompt` y el botón de instalar nunca aparece.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
)
