import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatCountdown, formatLongWait, useSecondsUntil } from '../useCountdown'

describe('formatCountdown', () => {
  it.each([
    [0, '0s'],
    [1, '1s'],
    [59, '59s'],
    [60, '1:00'],
    [61, '1:01'],
    [125, '2:05'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '60:00'],
  ])('formatea %i segundos como "%s"', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected)
  })
})

describe('formatLongWait', () => {
  it.each([
    [0, '1m'],
    [1, '1m'],
    [59, '1m'],
    [60, '1m'],
    [61, '2m'],
    [3540, '59m'],
    [3600, '1h'],
    [3660, '1h 1m'],
    [15120, '4h 12m'],
    [86400, '24h'],
  ])('formatea %i segundos como "%s"', (seconds, expected) => {
    expect(formatLongWait(seconds)).toBe(expected)
  })

  it('nunca muestra "0m" — una espera pendiente siempre es de al menos un minuto', () => {
    expect(formatLongWait(1)).toBe('1m')
  })
})

describe('useSecondsUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-03-10T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('devuelve 0 sin fecha objetivo', () => {
    expect(renderHook(() => useSecondsUntil(null)).result.current).toBe(0)
    expect(renderHook(() => useSecondsUntil(undefined)).result.current).toBe(0)
  })

  it('devuelve 0 para una fecha ya pasada', () => {
    const { result } = renderHook(() => useSecondsUntil('2025-03-10T09:59:00Z'))

    expect(result.current).toBe(0)
  })

  it('redondea hacia arriba los segundos restantes', () => {
    const { result } = renderHook(() => useSecondsUntil('2025-03-10T10:00:30.400Z'))

    expect(result.current).toBe(31)
  })

  it('baja un segundo por tick', () => {
    const { result } = renderHook(() => useSecondsUntil('2025-03-10T10:00:10Z'))
    expect(result.current).toBe(10)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current).toBe(7)
  })

  it('se recalcula desde la fecha límite, no restando de a uno', () => {
    // Simula una pestaña en segundo plano: el navegador saltea ticks, pero el
    // número no puede quedarse colgado por eso.
    const { result } = renderHook(() => useSecondsUntil('2025-03-10T10:00:10Z'))

    act(() => {
      vi.setSystemTime(new Date('2025-03-10T10:00:09Z'))
      vi.advanceTimersByTime(1000)
    })

    expect(result.current).toBe(0)
  })

  it('se detiene en cero y no sigue restando', () => {
    const { result } = renderHook(() => useSecondsUntil('2025-03-10T10:00:02Z'))

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(result.current).toBe(0)
  })

  it('reinicia el conteo cuando cambia la fecha objetivo', () => {
    const { result, rerender } = renderHook(({ target }) => useSecondsUntil(target), {
      initialProps: { target: '2025-03-10T10:00:05Z' as string | null },
    })
    expect(result.current).toBe(5)

    rerender({ target: '2025-03-10T10:01:00Z' })

    expect(result.current).toBe(60)
  })

  it('vuelve a cero cuando la fecha objetivo se limpia', () => {
    const { result, rerender } = renderHook(({ target }) => useSecondsUntil(target), {
      initialProps: { target: '2025-03-10T10:00:05Z' as string | null },
    })

    rerender({ target: null })

    expect(result.current).toBe(0)
  })

  it('limpia el intervalo al desmontarse', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderHook(() => useSecondsUntil('2025-03-10T10:05:00Z'))

    unmount()

    expect(clearSpy).toHaveBeenCalled()
  })
})
