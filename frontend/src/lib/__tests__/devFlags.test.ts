import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubMatchMedia } from '../../test/setup'
import {
  clearDevToolbarPosition,
  getDevToolbarPosition,
  isAiDisabled,
  isLocalhost,
  isRecaptchaV3Disabled,
  setAiDisabled,
  setDevToolbarPosition,
  setRecaptchaV3Disabled,
} from '../devFlags'

/** jsdom no deja reasignar `window.location`, así que se redefine el hostname. */
function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, hostname },
  })
}

const originalLocation = window.location

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

describe('isLocalhost', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', '::1'])('reconoce %s', (hostname) => {
    setHostname(hostname)
    expect(isLocalhost()).toBe(true)
  })

  it.each(['vistazo.app', 'preview.vercel.app', '192.168.0.10', 'localhost.evil.com'])(
    'no reconoce %s',
    (hostname) => {
      setHostname(hostname)
      expect(isLocalhost()).toBe(false)
    },
  )
})

describe('interruptor de IA', () => {
  beforeEach(() => setHostname('localhost'))

  it('arranca apagado', () => {
    expect(isAiDisabled()).toBe(false)
  })

  it('se persiste entre recargas', () => {
    setAiDisabled(true)

    expect(localStorage.getItem('vistazo-dev-ai-disabled')).toBe('true')
    expect(isAiDisabled()).toBe(true)
  })

  it('se puede volver a encender', () => {
    setAiDisabled(true)
    setAiDisabled(false)

    expect(isAiDisabled()).toBe(false)
  })

  it('NUNCA aplica fuera de localhost, aunque la clave esté puesta', () => {
    setAiDisabled(true)
    setHostname('vistazo.app')

    expect(isAiDisabled()).toBe(false)
  })

  it('no rompe si localStorage está bloqueado (modo incógnito)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(isAiDisabled()).toBe(false)
    expect(() => setAiDisabled(true)).not.toThrow()
  })
})

describe('interruptor de reCAPTCHA v3', () => {
  beforeEach(() => setHostname('localhost'))

  it('se persiste y se lee', () => {
    setRecaptchaV3Disabled(true)

    expect(localStorage.getItem('vistazo-dev-recaptcha-v3-disabled')).toBe('true')
    expect(isRecaptchaV3Disabled()).toBe(true)
  })

  it('NUNCA aplica fuera de localhost', () => {
    setRecaptchaV3Disabled(true)
    setHostname('vistazo.app')

    expect(isRecaptchaV3Disabled()).toBe(false)
  })

  it('no rompe si localStorage está bloqueado', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(isRecaptchaV3Disabled()).toBe(false)
  })
})

describe('posición de la barra de desarrollo', () => {
  it('sin nada guardado devuelve null', () => {
    expect(getDevToolbarPosition()).toBeNull()
  })

  it('guarda y recupera la posición dentro del mismo shell', () => {
    stubMatchMedia(() => false)
    setDevToolbarPosition({ top: 40, left: 12 })

    expect(getDevToolbarPosition()).toEqual({ top: 40, left: 12 })
  })

  it('etiqueta la posición con el shell en el que se arrastró', () => {
    stubMatchMedia(() => true)
    setDevToolbarPosition({ top: 40, left: 12 })

    expect(JSON.parse(localStorage.getItem('vistazo-dev-toolbar-pos')!)).toEqual({
      top: 40,
      left: 12,
      isMobile: true,
    })
  })

  it('descarta una posición arrastrada en el otro shell', () => {
    stubMatchMedia(() => true)
    setDevToolbarPosition({ top: 40, left: 12 })

    stubMatchMedia(() => false)
    expect(getDevToolbarPosition()).toBeNull()
  })

  it('descarta un valor guardado con forma incorrecta', () => {
    localStorage.setItem('vistazo-dev-toolbar-pos', JSON.stringify({ top: '40', left: 12, isMobile: false }))

    expect(getDevToolbarPosition()).toBeNull()
  })

  it('descarta un JSON corrupto en vez de romper', () => {
    localStorage.setItem('vistazo-dev-toolbar-pos', 'no-es-json')

    expect(getDevToolbarPosition()).toBeNull()
  })

  it('acepta la esquina (0, 0) como posición real', () => {
    stubMatchMedia(() => false)
    setDevToolbarPosition({ top: 0, left: 0 })

    expect(getDevToolbarPosition()).toEqual({ top: 0, left: 0 })
  })

  it('se puede limpiar', () => {
    stubMatchMedia(() => false)
    setDevToolbarPosition({ top: 40, left: 12 })
    clearDevToolbarPosition()

    expect(getDevToolbarPosition()).toBeNull()
  })

  it('no rompe si localStorage está bloqueado', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    stubMatchMedia(() => false)
    expect(() => setDevToolbarPosition({ top: 1, left: 1 })).not.toThrow()
    expect(() => clearDevToolbarPosition()).not.toThrow()
  })
})
