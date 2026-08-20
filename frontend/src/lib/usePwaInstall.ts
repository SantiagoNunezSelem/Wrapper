import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari (todas las plataformas, no sólo iOS) no soporta `display-mode` en
    // `matchMedia`; expone esta propiedad no estándar en su lugar.
    (navigator as { standalone?: boolean }).standalone === true
  )
}

// Capturado a nivel de módulo, no dentro del hook: Chrome dispara
// `beforeinstallprompt` una única vez por carga de página — normalmente antes de
// que el usuario haga nada — y no lo repite para listeners que lleguen tarde. Si
// sólo se escuchara desde `usePwaInstall`, el botón jamás vería el evento salvo
// que el usuario ya estuviera en el paso de instalación en el instante exacto en
// que Chrome decide que el sitio es instalable, algo que casi nunca coincide.
let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = isStandalone()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event as BeforeInstallPromptEvent
  notify()
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  installed = true
  notify()
})

/**
 * Wrapper de `beforeinstallprompt` (Chrome/Edge/Android — Safari nunca lo dispara,
 * ni de escritorio ni de iOS). El evento sólo llega si `/manifest.json` y el
 * service worker (ver `main.tsx`) ya se registraron con éxito.
 */
export function usePwaInstall() {
  const [, forceRender] = useState(0)

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferredPrompt) {
      return 'unavailable'
    }

    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    notify()
    return outcome
  }

  return { canInstall: deferredPrompt !== null, isInstalled: installed, install }
}
