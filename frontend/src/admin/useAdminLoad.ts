import { useEffect, useRef, useState } from 'react'

interface LoadState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/**
 * Carga un recurso del panel y lo vuelve a pedir cuando cambia `key`.
 *
 * La función de carga va por una ref y no en las dependencias: cambia en cada render (es
 * una flecha nueva), y lo que decide si hay que volver a pedir es la clave, no la función.
 * Mientras recarga se conserva el dato anterior, así la pantalla no parpadea en blanco.
 */
export function useAdminLoad<T>(key: string, load: () => Promise<T>) {
  const loadRef = useRef(load)
  const [state, setState] = useState<LoadState<T>>({ data: null, error: null, loading: true })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let alive = true
    setState((previous) => ({ ...previous, loading: true, error: null }))

    loadRef.current().then(
      (data) => {
        if (alive) setState({ data, error: null, loading: false })
      },
      (error: unknown) => {
        if (alive) {
          setState((previous) => ({
            data: previous.data,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          }))
        }
      },
    )

    return () => {
      alive = false
    }
  }, [key, attempt])

  return {
    ...state,
    reload: () => setAttempt((value) => value + 1),
    replace: (data: T) => setState({ data, error: null, loading: false }),
  }
}
