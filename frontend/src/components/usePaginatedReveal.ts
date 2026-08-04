import { useEffect, useRef, useState } from 'react'

export const PAGE_SIZE = 5

/**
 * Pagina una lista de "mostrar más" y resalta un momento los elementos recién
 * revelados.
 *
 * Una métrica puede traer `groups` y `paginatedItems` a la vez (por ejemplo los
 * mensajes picantes y las palabras picantes), así que cada lista necesita su
 * propio contador: compartir uno haría que revelar una saltara la otra.
 *
 * Vive fuera de `MetricModal` porque la hoja de detalle de mobile pagina igual,
 * y dos copias del mismo contador es justo la clase de cosa que después se
 * desincroniza entre los dos shells.
 */
export function usePaginatedReveal(pageSize: number = PAGE_SIZE) {
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const [revealedFrom, setRevealedFrom] = useState<number | null>(null)
  const listRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (revealedFrom === null) {
      return
    }
    const target = listRef.current?.children[revealedFrom] as HTMLElement | undefined
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    const timeout = setTimeout(() => setRevealedFrom(null), 1000)
    return () => clearTimeout(timeout)
  }, [revealedFrom])

  return {
    visibleCount,
    revealedFrom,
    setListRef: (node: HTMLElement | null) => {
      listRef.current = node
    },
    showMore: () => {
      setRevealedFrom(visibleCount)
      setVisibleCount((count) => count + pageSize)
    },
    /** La hoja de mobile reusa una sola instancia mientras el usuario pasa de una
     * métrica a la siguiente, así que necesita volver el contador al principio. */
    reset: () => {
      setVisibleCount(pageSize)
      setRevealedFrom(null)
    },
  }
}
