import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubIntersectionObserver } from '../../test/setup'
import { useInView } from '../useInView'

function Section() {
  const { ref, inView } = useInView<HTMLDivElement>()
  return <div ref={ref} data-testid="section">{inView ? 'visible' : 'oculto'}</div>
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useInView', () => {
  it('arranca oculto', () => {
    stubIntersectionObserver()
    render(<Section />)

    expect(screen.getByTestId('section')).toHaveTextContent('oculto')
  })

  it('se enciende cuando el elemento entra en pantalla', () => {
    const observer = stubIntersectionObserver()
    render(<Section />)

    act(() => observer.triggerIntersect())

    expect(screen.getByTestId('section')).toHaveTextContent('visible')
  })

  it('no se apaga al salir de pantalla', () => {
    const observer = stubIntersectionObserver()
    render(<Section />)

    act(() => observer.triggerIntersect(true))
    act(() => observer.triggerIntersect(false))

    expect(screen.getByTestId('section')).toHaveTextContent('visible')
  })

  it('se enciende igual a los 2 segundos, aunque el observer nunca dispare', () => {
    stubIntersectionObserver()
    render(<Section />)

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByTestId('section')).toHaveTextContent('visible')
  })

  it('deja de observar una vez visible', () => {
    const observer = stubIntersectionObserver()
    render(<Section />)

    act(() => observer.triggerIntersect())

    // El efecto se rearma con inView=true y sale sin crear un observer nuevo.
    expect(observer.instances.every((instance) => instance.disconnected)).toBe(true)
  })

  it('no rompe en un entorno sin IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined)

    expect(() => render(<Section />)).not.toThrow()
    expect(screen.getByTestId('section')).toHaveTextContent('oculto')
  })
})
