import { Suspense, lazy, type ComponentType } from 'react'

/** Qué se dibuja mientras baja el chunk. */
type PanelFallback =
  /** Nada. Para overlays y modales: abajo sigue estando la pantalla que los invocó, y un
   *  spinner por los pocos milisegundos que tarda el chunk parpadea más de lo que informa. */
  | 'none'
  /** El spinner a pantalla completa. Para las pantallas que reemplazan todo lo demás,
   *  donde "nada" sería una pantalla en blanco. */
  | 'screen'

/**
 * Carga un componente recién cuando se lo va a dibujar, con su propio `Suspense`.
 *
 * Existe para lo que vive detrás de un click: la página de suscripción, el recorrido
 * tipo historia, el tutorial de exportación con sus ilustraciones. Nada de eso hace
 * falta para pintar la primera pantalla, y entre todo sumaba peso al bundle que sí la
 * bloquea.
 *
 * La frontera de `Suspense` va acá adentro, una por componente, y no una sola arriba
 * del shell: así la carga de un modal no suspende de más y desmonta lo que hay debajo
 * mientras baja.
 *
 * El módulo y el componente van separados —`lazyPanel(() => import('./Foo'), (m) => m.Foo)`—
 * y no como un `.then` que devuelva `{ default }`, porque así los props se infieren solos:
 * primero el tipo del módulo desde el import, después los props desde el selector. Con el
 * `.then`, TypeScript tendría que inferir los props desde adentro de un callback que a la
 * vez está tipado por ellos, se muerde la cola y los resuelve como `never`.
 */
export function lazyPanel<Module, Props extends object>(
  load: () => Promise<Module>,
  pick: (module: Module) => ComponentType<Props>,
  fallback: PanelFallback = 'none',
): ComponentType<Props> {
  const Loaded = lazy(async () => ({ default: pick(await load()) }))

  // Reusa el CSS del overlay que el shell ya muestra para cualquier otra espera, para
  // que bajar un chunk se vea igual que guardar un análisis o iniciar sesión.
  //
  // `role="status"` y no `"alert"`: es una espera, no algo que haya que interrumpir para
  // anunciar. Sin texto adentro no dice nada, que es lo correcto — el lector de pantalla
  // va a leer la pantalla real apenas termine de montar.
  const waiting =
    fallback === 'screen' ? (
      <div className="loading-overlay" role="status">
        <div className="loading-overlay-spinner" aria-hidden="true" />
      </div>
    ) : null

  function LazyPanel(props: Props) {
    return (
      <Suspense fallback={waiting}>
        <Loaded {...props} />
      </Suspense>
    )
  }

  return LazyPanel
}
