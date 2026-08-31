import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubMatchMedia } from '../../test/setup'

/**
 * El módulo se suscribe a `beforeinstallprompt` al importarse — a propósito, porque
 * Chrome dispara ese evento una sola vez por carga y no lo repite para quien se suscriba
 * tarde. Por eso cada test recarga el módulo: es la única forma de controlar el estado
 * inicial (¿ya estaba instalada?) y de que el listener exista antes del evento.
 */
async function freshModule() {
  vi.resetModules()
  return import('../usePwaInstall')
}

function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  // `cancelable`, porque el hook llama a `preventDefault()` para quedarse con el
  // control del momento en que se ofrece instalar.
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  event.prompt = vi.fn(async () => {})
  event.userChoice = Promise.resolve({ outcome })

  act(() => {
    window.dispatchEvent(event)
  })

  return event
}

beforeEach(() => {
  stubMatchMedia(() => false)
})

describe('usePwaInstall', () => {
  it('sin evento de Chrome no se puede instalar', async () => {
    const { usePwaInstall } = await freshModule()
    const { result } = renderHook(() => usePwaInstall())

    expect(result.current.canInstall).toBe(false)
    expect(result.current.isInstalled).toBe(false)
  })

  it('detecta la app ya instalada por display-mode standalone', async () => {
    stubMatchMedia((query) => query.includes('standalone'))
    const { usePwaInstall } = await freshModule()

    expect(renderHook(() => usePwaInstall()).result.current.isInstalled).toBe(true)
  })

  it('detecta la app ya instalada en Safari, que no soporta display-mode', async () => {
    stubMatchMedia(() => false)
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    try {
      const { usePwaInstall } = await freshModule()

      expect(renderHook(() => usePwaInstall()).result.current.isInstalled).toBe(true)
    } finally {
      Reflect.deleteProperty(navigator, 'standalone')
    }
  })

  it('se habilita cuando Chrome ofrece la instalación', async () => {
    const { usePwaInstall } = await freshModule()
    const { result } = renderHook(() => usePwaInstall())

    fireInstallPrompt()

    expect(result.current.canInstall).toBe(true)
  })

  it('cancela el banner nativo de Chrome para mostrar el botón propio', async () => {
    const { usePwaInstall } = await freshModule()
    renderHook(() => usePwaInstall())

    const event = fireInstallPrompt()

    expect(event.defaultPrevented).toBe(true)
  })

  it('instalar devuelve lo que eligió el usuario', async () => {
    const { usePwaInstall } = await freshModule()
    const { result } = renderHook(() => usePwaInstall())
    const event = fireInstallPrompt('accepted')

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.install()
    })

    expect(event.prompt).toHaveBeenCalled()
    expect(outcome).toBe('accepted')
  })

  it('un rechazo también se informa', async () => {
    const { usePwaInstall } = await freshModule()
    const { result } = renderHook(() => usePwaInstall())
    fireInstallPrompt('dismissed')

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.install()
    })

    expect(outcome).toBe('dismissed')
  })

  it('el prompt se consume: no se puede volver a instalar con el mismo evento', async () => {
    const { usePwaInstall } = await freshModule()
    const { result } = renderHook(() => usePwaInstall())
    fireInstallPrompt()

    await act(async () => {
      await result.current.install()
    })

    expect(result.current.canInstall).toBe(false)
    await expect(result.current.install()).resolves.toBe('unavailable')
  })

  it('sin prompt disponible devuelve "unavailable" en vez de romper', async () => {
    const { usePwaInstall } = await freshModule()
    const { result } = renderHook(() => usePwaInstall())

    await expect(result.current.install()).resolves.toBe('unavailable')
  })

  it('marca la app como instalada cuando el navegador lo confirma', async () => {
    const { usePwaInstall } = await freshModule()
    const { result } = renderHook(() => usePwaInstall())
    fireInstallPrompt()

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(result.current.isInstalled).toBe(true)
    expect(result.current.canInstall).toBe(false)
  })

  it('todas las instancias del hook ven el mismo estado', async () => {
    const { usePwaInstall } = await freshModule()
    const first = renderHook(() => usePwaInstall())
    const second = renderHook(() => usePwaInstall())

    fireInstallPrompt()

    expect(first.result.current.canInstall).toBe(true)
    expect(second.result.current.canInstall).toBe(true)
  })

  it('se desuscribe al desmontarse', async () => {
    const { usePwaInstall } = await freshModule()
    const { unmount } = renderHook(() => usePwaInstall())

    unmount()

    expect(() => fireInstallPrompt()).not.toThrow()
  })
})
