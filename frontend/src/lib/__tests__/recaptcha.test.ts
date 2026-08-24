import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `loadRecaptchaScript` recuerda a nivel de módulo qué site keys ya inyectó, así que
 * cada test recarga el módulo para arrancar de cero.
 */
async function freshModule() {
  vi.resetModules()
  return import('../recaptcha')
}

function fakeGrecaptcha(overrides: Partial<Window['grecaptcha']> = {}) {
  return {
    ready: vi.fn((callback: () => void) => callback()),
    execute: vi.fn(async () => 'token-v3'),
    render: vi.fn(() => 1),
    ...overrides,
  } as NonNullable<Window['grecaptcha']>
}

beforeEach(() => {
  document.head.innerHTML = ''
  delete window.grecaptcha
})

afterEach(() => {
  vi.useRealTimers()
  delete window.grecaptcha
})

describe('loadRecaptchaScript', () => {
  it('resuelve sin hacer nada cuando no hay site key', async () => {
    const { loadRecaptchaScript } = await freshModule()

    await expect(loadRecaptchaScript('')).resolves.toBeUndefined()
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('resuelve enseguida si grecaptcha ya estaba cargado', async () => {
    const grecaptcha = fakeGrecaptcha()
    window.grecaptcha = grecaptcha
    const { loadRecaptchaScript } = await freshModule()

    await expect(loadRecaptchaScript('site-key')).resolves.toBeUndefined()
    expect(grecaptcha.ready).toHaveBeenCalled()
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('inyecta el script con la site key escapada', async () => {
    const { loadRecaptchaScript } = await freshModule()
    void loadRecaptchaScript('site key/con espacios')

    const script = document.head.querySelector('script')!
    expect(script.src).toBe('https://www.google.com/recaptcha/api.js?render=site%20key%2Fcon%20espacios')
    expect(script.async).toBe(true)
    expect(script.defer).toBe(true)
  })

  it('inyecta el script una sola vez por site key', async () => {
    const { loadRecaptchaScript } = await freshModule()
    void loadRecaptchaScript('site-key')
    void loadRecaptchaScript('site-key')

    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })

  it('resuelve en cuanto grecaptcha aparece en la ventana', async () => {
    vi.useFakeTimers()
    const { loadRecaptchaScript } = await freshModule()
    const pending = loadRecaptchaScript('site-key')

    window.grecaptcha = fakeGrecaptcha()
    await vi.advanceTimersByTimeAsync(150)

    await expect(pending).resolves.toBeUndefined()
  })

  it('rechaza si el script no carga', async () => {
    const { loadRecaptchaScript } = await freshModule()
    const pending = loadRecaptchaScript('site-key')

    document.head.querySelector('script')!.onerror?.(new Event('error'))

    await expect(pending).rejects.toThrow('Could not load reCAPTCHA.')
  })

  it('rechaza tras 10 segundos sin que aparezca grecaptcha', async () => {
    vi.useFakeTimers()
    const { loadRecaptchaScript } = await freshModule()
    const pending = loadRecaptchaScript('site-key')
    const assertion = expect(pending).rejects.toThrow('reCAPTCHA did not load in time.')

    await vi.advanceTimersByTimeAsync(10_500)

    await assertion
  })
})

describe('executeRecaptchaV3', () => {
  it('devuelve undefined sin site key', async () => {
    window.grecaptcha = fakeGrecaptcha()
    const { executeRecaptchaV3 } = await freshModule()

    await expect(executeRecaptchaV3('', 'login')).resolves.toBeUndefined()
  })

  it('devuelve undefined si el script nunca cargó', async () => {
    const { executeRecaptchaV3 } = await freshModule()

    await expect(executeRecaptchaV3('site-key', 'login')).resolves.toBeUndefined()
  })

  it('pide el token para la acción indicada', async () => {
    const grecaptcha = fakeGrecaptcha()
    window.grecaptcha = grecaptcha
    const { executeRecaptchaV3 } = await freshModule()

    await expect(executeRecaptchaV3('site-key', 'login')).resolves.toBe('token-v3')
    expect(grecaptcha.execute).toHaveBeenCalledWith('site-key', { action: 'login' })
  })
})

describe('renderRecaptchaV2', () => {
  it('dibuja el checkbox y devuelve el token resuelto', async () => {
    let captured: ((token: string) => void) | null = null
    const grecaptcha = fakeGrecaptcha({
      render: vi.fn((_container, parameters: { sitekey: string; callback: (token: string) => void }) => {
        captured = parameters.callback
        return 1
      }),
    })
    window.grecaptcha = grecaptcha
    const { renderRecaptchaV2 } = await freshModule()

    const container = document.createElement('div')
    const onToken = vi.fn()
    renderRecaptchaV2(container, 'site-key-v2', onToken)

    expect(grecaptcha.render).toHaveBeenCalledWith(container, {
      sitekey: 'site-key-v2',
      callback: expect.any(Function),
    })

    captured!('token-v2')
    expect(onToken).toHaveBeenCalledWith('token-v2')
  })

  it('no rompe si grecaptcha no está disponible', async () => {
    const { renderRecaptchaV2 } = await freshModule()

    expect(() => renderRecaptchaV2(document.createElement('div'), 'k', vi.fn())).not.toThrow()
  })
})
