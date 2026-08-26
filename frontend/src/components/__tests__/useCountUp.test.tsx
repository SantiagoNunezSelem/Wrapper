import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubIntersectionObserver, stubMatchMedia } from '../../test/setup'
import { useCountUp, useCountUpOnView } from '../useCountUp'

/** La animación dura 900ms; con 1000 siempre termina. */
const PAST_THE_END = 1000

beforeEach(() => {
  vi.useFakeTimers()
  stubMatchMedia(() => false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCountUp', () => {
  it('arranca en cero y termina en el valor real', () => {
    const { result } = renderHook(() => useCountUp('12.482 mensajes'))

    expect(result.current).toBe('0 mensajes')

    act(() => {
      vi.advanceTimersByTime(PAST_THE_END)
    })

    expect(result.current).toBe('12.482 mensajes')
  })

  it('conserva el prefijo del valor', () => {
    const { result } = renderHook(() => useCountUp('×90'))

    expect(result.current).toBe('×0')

    act(() => {
      vi.advanceTimersByTime(PAST_THE_END)
    })

    expect(result.current).toBe('×90')
  })

  it('mantiene los decimales durante la animación', () => {
    const { result } = renderHook(() => useCountUp('38.2%'))

    expect(result.current).toBe('0.0%')

    act(() => {
      vi.advanceTimersByTime(PAST_THE_END)
    })

    expect(result.current).toBe('38.2%')
  })

  it('interpreta la coma decimal del formato en inglés', () => {
    const { result } = renderHook(() => useCountUp('3,5 horas'))

    expect(result.current).toBe('0,0 horas'.replace(',', '.'))
  })

  it('reagrupa los miles mientras cuenta', () => {
    const { result } = renderHook(() => useCountUp('1.500'))

    act(() => {
      vi.advanceTimersByTime(450)
    })

    // A mitad de camino ya pasó los mil y tiene que llevar el separador puesto.
    expect(result.current).toMatch(/^1\.\d{3}$/)
  })

  it.each(['Hora pico: Noche', 'Lun', 'Hora pico: Mañana', ''])('deja "%s" tal cual: no tiene número', (value) => {
    const { result } = renderHook(() => useCountUp(value))

    expect(result.current).toBe(value)
  })

  it('respeta la preferencia de menos movimiento', () => {
    stubMatchMedia((query) => query.includes('prefers-reduced-motion'))
    const { result } = renderHook(() => useCountUp('12.482 mensajes'))

    expect(result.current).toBe('12.482 mensajes')
  })

  it('vuelve a contar cuando cambia el valor', () => {
    const { result, rerender } = renderHook(({ value }) => useCountUp(value), {
      initialProps: { value: '10' },
    })
    act(() => {
      vi.advanceTimersByTime(PAST_THE_END)
    })
    expect(result.current).toBe('10')

    rerender({ value: '99' })

    expect(result.current).toBe('0')
  })

  it('cancela la animación al desmontarse', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const { unmount } = renderHook(() => useCountUp('12.482'))

    unmount()

    expect(cancelSpy).toHaveBeenCalled()
  })
})

describe('useCountUpOnView', () => {
  function Stat({ value }: { value: string }) {
    const [display, ref] = useCountUpOnView<HTMLSpanElement>(value)
    return <span ref={ref} data-testid="stat">{display}</span>
  }

  it('espera a que el elemento entre en pantalla para empezar', () => {
    const observer = stubIntersectionObserver()
    render(<Stat value="1.243" />)

    expect(screen.getByTestId('stat')).toHaveTextContent('0')

    act(() => {
      vi.advanceTimersByTime(PAST_THE_END)
    })
    // Sin haber entrado en pantalla, sigue en cero.
    expect(screen.getByTestId('stat')).toHaveTextContent('0')

    act(() => {
      observer.triggerIntersect()
      vi.advanceTimersByTime(PAST_THE_END)
    })

    expect(screen.getByTestId('stat')).toHaveTextContent('1.243')
  })

  it('cuenta una sola vez: volver a entrar en pantalla no reinicia', () => {
    const observer = stubIntersectionObserver()
    render(<Stat value="500" />)

    act(() => {
      observer.triggerIntersect()
      vi.advanceTimersByTime(PAST_THE_END)
    })
    expect(screen.getByTestId('stat')).toHaveTextContent('500')

    act(() => {
      observer.triggerIntersect()
    })

    expect(screen.getByTestId('stat')).toHaveTextContent('500')
  })

  it('con menos movimiento muestra el valor sin animar', () => {
    stubMatchMedia((query) => query.includes('prefers-reduced-motion'))
    stubIntersectionObserver()
    render(<Stat value="1.243" />)

    expect(screen.getByTestId('stat')).toHaveTextContent('1.243')
  })

  it('un valor sin número se muestra tal cual', () => {
    stubIntersectionObserver()
    render(<Stat value="Hora pico: Noche" />)

    expect(screen.getByTestId('stat')).toHaveTextContent('Hora pico: Noche')
  })
})
