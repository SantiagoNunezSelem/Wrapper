import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { stubMatchMedia } from '../../test/setup'
import { useIsMobile } from '../useIsMobile'

const QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none) and (max-width: 1024px)'

describe('useIsMobile', () => {
  it('usa una única media query que cubre ancho y táctil', () => {
    let seen = ''
    stubMatchMedia((query) => {
      seen = query
      return false
    })

    renderHook(() => useIsMobile())

    expect(seen).toBe(QUERY)
  })

  it('devuelve false en desktop', () => {
    stubMatchMedia(() => false)

    expect(renderHook(() => useIsMobile()).result.current).toBe(false)
  })

  it('devuelve true cuando la query matchea', () => {
    stubMatchMedia(() => true)

    expect(renderHook(() => useIsMobile()).result.current).toBe(true)
  })

  it('cambia de shell en vivo al rotar el teléfono', () => {
    const media = stubMatchMedia(() => false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => {
      media.emitChange(QUERY, true)
    })

    expect(result.current).toBe(true)
  })

  it('también relee en el resize, para entornos donde el evento de la query no llega', () => {
    let matches = false
    stubMatchMedia(() => matches)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    matches = true
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current).toBe(true)
  })

  it('deja de escuchar al desmontarse', () => {
    let matches = false
    stubMatchMedia(() => matches)
    const { result, unmount } = renderHook(() => useIsMobile())

    unmount()
    matches = true

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    // Sin listener, el valor del último render queda como estaba.
    expect(result.current).toBe(false)
  })
})
