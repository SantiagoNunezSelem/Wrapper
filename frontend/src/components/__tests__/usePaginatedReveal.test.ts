import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_SIZE, usePaginatedReveal } from '../usePaginatedReveal'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePaginatedReveal', () => {
  it('arranca mostrando una página', () => {
    const { result } = renderHook(() => usePaginatedReveal())

    expect(PAGE_SIZE).toBe(5)
    expect(result.current.visibleCount).toBe(5)
    expect(result.current.revealedFrom).toBeNull()
  })

  it('acepta un tamaño de página propio', () => {
    const { result } = renderHook(() => usePaginatedReveal(3))

    expect(result.current.visibleCount).toBe(3)
  })

  it('"ver más" suma una página y marca desde dónde resaltar', () => {
    const { result } = renderHook(() => usePaginatedReveal())

    act(() => result.current.showMore())

    expect(result.current.visibleCount).toBe(10)
    expect(result.current.revealedFrom).toBe(5)
  })

  it('acumula páginas en clics sucesivos', () => {
    const { result } = renderHook(() => usePaginatedReveal())

    act(() => result.current.showMore())
    act(() => result.current.showMore())

    expect(result.current.visibleCount).toBe(15)
    expect(result.current.revealedFrom).toBe(10)
  })

  it('apaga el resaltado después de un segundo', () => {
    const { result } = renderHook(() => usePaginatedReveal())

    act(() => result.current.showMore())
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.revealedFrom).toBeNull()
    expect(result.current.visibleCount).toBe(10)
  })

  it('lleva a la vista el primer elemento recién revelado', () => {
    const scrollIntoView = vi.fn()
    const list = document.createElement('ul')
    for (let index = 0; index < 8; index += 1) {
      const item = document.createElement('li')
      item.scrollIntoView = scrollIntoView
      list.appendChild(item)
    }

    const { result } = renderHook(() => usePaginatedReveal())
    act(() => result.current.setListRef(list))
    act(() => result.current.showMore())

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
  })

  it('no rompe si todavía no hay lista montada', () => {
    const { result } = renderHook(() => usePaginatedReveal())
    act(() => result.current.setListRef(null))

    expect(() => act(() => result.current.showMore())).not.toThrow()
  })

  it('reset vuelve el contador al principio', () => {
    const { result } = renderHook(() => usePaginatedReveal())

    act(() => result.current.showMore())
    act(() => result.current.reset())

    expect(result.current.visibleCount).toBe(5)
    expect(result.current.revealedFrom).toBeNull()
  })

  it('dos instancias llevan contadores independientes', () => {
    const groups = renderHook(() => usePaginatedReveal())
    const items = renderHook(() => usePaginatedReveal())

    act(() => groups.result.current.showMore())

    expect(groups.result.current.visibleCount).toBe(10)
    expect(items.result.current.visibleCount).toBe(5)
  })
})
