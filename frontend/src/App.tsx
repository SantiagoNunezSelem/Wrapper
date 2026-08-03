import { useVistazo } from './app/useVistazo'
import { DesktopShell } from './shells/desktop/DesktopShell'

/**
 * La raíz: arma el estado una sola vez y elige quién lo dibuja.
 *
 * Toda la lógica vive en `useVistazo()` y todo el layout en un shell, así que
 * este archivo no debería crecer: cuando entre el shell de mobile, lo único
 * que cambia acá es de qué lado del `if` se renderiza.
 */
function App() {
  const vistazo = useVistazo()

  return <DesktopShell vistazo={vistazo} />
}

export default App
