import { useIsMobile } from './app/useIsMobile'
import { useVistazo } from './app/useVistazo'
import { DesktopShell } from './shells/desktop/DesktopShell'
import { MobileShell } from './shells/mobile/MobileShell'
import { lazyPanel } from './components/lazyPanel'
import { TestPayerBanner } from './components/TestPayerBanner'

// La página pública de un recorrido compartido: la ve quien abre un link `/s/{slug}`,
// que no es el recorrido normal de nadie que ya está usando la app. Cargarla aparte
// deja fuera del bundle principal todo lo que arrastra (StoryMode y sus gráficos).
const SharedStoryView = lazyPanel(
  () => import('./shells/mobile/SharedStoryView'),
  (m) => m.SharedStoryView,
  // Es la pantalla entera y encima la primera que ve quien abre el link: sin fallback,
  // el link recién compartido abre en blanco.
  'screen',
)

/**
 * La raíz: arma el estado una sola vez y elige quién lo dibuja.
 *
 * Los dos shells reciben el mismo objeto, así que las métricas, el gate de VIP,
 * la fase de IA y la suscripción son el mismo código corriendo en los dos. Lo
 * único que cambia entre ellos es el layout.
 *
 * `useVistazo()` se llama arriba del `if` a propósito: si cada shell armara el
 * suyo, cambiar de uno a otro al rotar el teléfono desmontaría el estado y
 * perdería el análisis que está en pantalla.
 */
function App() {
  const vistazo = useVistazo()
  const isMobile = useIsMobile()

  // `/s/{slug}` es un recorrido compartido: no es la app, es una página pública
  // de lectura. Quien la abre puede no tener sesión ni chat cargado — sólo el
  // link — así que se resuelve antes que la elección de shell.
  //
  // Se muestra igual en teléfono y en escritorio: un recorrido tipo historia es
  // vertical por naturaleza, y el link se abre desde donde sea.
  if (vistazo.shareSlug) {
    return <SharedStoryView slug={vistazo.shareSlug} />
  }

  // Above the shell choice so it shows on both, and outside either one so neither can
  // scroll it away: while checkout is pinned to a test payer, that fact outranks whatever
  // screen you happen to be on.
  return (
    <>
      <TestPayerBanner
        email={vistazo.user?.checkoutTestPayerEmail ?? null}
        title={vistazo.copy.subscriptionPage.testPayerBannerTitle}
        body={vistazo.copy.subscriptionPage.testPayerBannerBody}
      />
      {isMobile ? <MobileShell vistazo={vistazo} /> : <DesktopShell vistazo={vistazo} />}
    </>
  )
}

export default App
