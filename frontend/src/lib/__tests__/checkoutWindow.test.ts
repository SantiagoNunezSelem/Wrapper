import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubMatchMedia } from '../../test/setup'
import { CHECKOUT_WINDOW_OPENED, finishCheckoutInWindow, goToCheckout, prefersCheckoutWindow } from '../checkoutWindow'

/** Escritorio de verdad: mouse, ventana ancha y sin instalar como app. */
function desktop() {
  stubMatchMedia((query) => query === '(pointer: fine)')
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
}

function fakeWindow() {
  return {
    closed: false,
    location: { href: 'about:blank' },
    document: { title: '', body: { style: { cssText: '' }, textContent: '' } },
    focus: vi.fn(),
    close: vi.fn(),
  }
}

describe('checkoutWindow', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // jsdom no navega: alcanza con ver a dónde se habría ido la pestaña.
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, href: 'http://localhost/suscripcion', search: '' },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true })
    vi.restoreAllMocks()
  })

  describe('cuándo usar otra ventana', () => {
    it('en escritorio, sí', () => {
      desktop()
      expect(prefersCheckoutWindow()).toBe(true)
    })

    it('en el celular (pantalla táctil), no: la pestaña va directo', () => {
      stubMatchMedia(() => false)
      Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
      expect(prefersCheckoutWindow()).toBe(false)
    })

    it('en la app instalada, no: una ventana suelta ahí es más difícil de dejar que un redirect', () => {
      stubMatchMedia((query) => query === '(pointer: fine)' || query === '(display-mode: standalone)')
      Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
      expect(prefersCheckoutWindow()).toBe(false)
    })
  })

  describe('goToCheckout', () => {
    it('abre la ventana en el clic y le pone la dirección cuando llega', async () => {
      desktop()
      const popup = fakeWindow()
      const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
      const opened = vi.fn()
      window.addEventListener(CHECKOUT_WINDOW_OPENED, opened)

      const where = await goToCheckout(async () => 'https://mp.test/checkout')

      expect(where).toBe('window')
      expect(open).toHaveBeenCalledTimes(1)
      expect(popup.location.href).toBe('https://mp.test/checkout')
      expect(window.location.href).toBe('http://localhost/suscripcion')
      expect(opened).toHaveBeenCalledTimes(1)
      window.removeEventListener(CHECKOUT_WINDOW_OPENED, opened)
    })

    it('si el navegador bloquea la ventana, se va en la misma pestaña como siempre', async () => {
      desktop()
      vi.spyOn(window, 'open').mockReturnValue(null)

      const where = await goToCheckout(async () => 'https://mp.test/checkout')

      expect(where).toBe('redirect')
      expect(window.location.href).toBe('https://mp.test/checkout')
    })

    it('en el celular no abre ninguna ventana', async () => {
      stubMatchMedia(() => false)
      const open = vi.spyOn(window, 'open')

      await goToCheckout(() => 'https://mp.test/checkout')

      expect(open).not.toHaveBeenCalled()
      expect(window.location.href).toBe('https://mp.test/checkout')
    })

    it('si el servidor no abre el checkout, cierra la ventana vacía', async () => {
      desktop()
      const popup = fakeWindow()
      vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)

      await expect(goToCheckout(async () => Promise.reject(new Error('502')))).rejects.toThrow('502')
      expect(popup.close).toHaveBeenCalled()
    })
  })

  describe('finishCheckoutInWindow', () => {
    it('una página normal no hace nada', () => {
      expect(finishCheckoutInWindow()).toBe(false)
    })

    it('al volver de Mercado Pago avisa a las otras pestañas', () => {
      window.location.search = '?checkout=return'
      const received = vi.fn()
      const listener = new BroadcastChannel('vistazo-checkout')
      listener.onmessage = (event) => received(event.data)

      finishCheckoutInWindow()

      return vi.waitFor(() => {
        expect(received).toHaveBeenCalledWith('return')
        listener.close()
      })
    })

    it('si esta pestaña no la abrió Vistazo, sigue siendo una pestaña normal', () => {
      window.location.search = '?checkout=return'
      expect(finishCheckoutInWindow()).toBe(false)
    })
  })
})
