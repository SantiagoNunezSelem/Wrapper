import { useIsMobile } from './app/useIsMobile'
import { useVistazo } from './app/useVistazo'
import { DesktopShell } from './shells/desktop/DesktopShell'
import { MobileShell } from './shells/mobile/MobileShell'

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

  return isMobile ? <MobileShell vistazo={vistazo} /> : <DesktopShell vistazo={vistazo} />
}

export default App
