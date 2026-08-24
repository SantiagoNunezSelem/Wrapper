import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  analyzeAiMetrics,
  cancelSubscription,
  createShare,
  getAiMetrics,
  getCurrentUser,
  getFreeUnlocks,
  getSharedStory,
  getSubscription,
  grantAiConsent,
  listAnalyses,
  loginWithGoogle,
  resetDevFreeUnlocks,
  retryAiMetrics,
  saveAnalysis,
  spendFreeUnlock,
  startCheckout,
  syncSubscription,
  toggleDevSubscription,
} from '../api'

const BASE = 'http://localhost:5175'

let fetchMock: ReturnType<typeof vi.fn>

/** Responde con un JSON 200. */
function respondWith(body: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

/** Responde con un error, opcionalmente con el cuerpo crudo que manda el backend. */
function failWith(status: number, rawBody: string) {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    text: async () => rawBody,
    json: async () => JSON.parse(rawBody),
  })
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, headers: (init?.headers ?? {}) as Record<string, string> }
}

/** Ejecuta la llamada esperando que rechace, y devuelve el `ApiError` ya tipado. */
async function captureApiError(call: Promise<unknown>): Promise<ApiError> {
  const outcome = await call.then(
    () => null,
    (error: unknown) => error,
  )

  if (!(outcome instanceof ApiError)) {
    throw new Error(`Se esperaba un ApiError, llegó: ${String(outcome)}`)
  }

  return outcome
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  respondWith({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('capa de transporte', () => {
  it('pega contra la URL base por defecto', async () => {
    await getCurrentUser('tok')

    expect(lastCall().url).toBe(`${BASE}/api/auth/me`)
  })

  it('manda siempre Content-Type application/json', async () => {
    await getCurrentUser('tok')

    expect(lastCall().headers['Content-Type']).toBe('application/json')
  })

  it('agrega el bearer cuando hay token', async () => {
    await getCurrentUser('mi-token')

    expect(lastCall().headers.Authorization).toBe('Bearer mi-token')
  })

  it('no manda Authorization en las rutas públicas', async () => {
    await getSharedStory('abc123')

    expect(lastCall().headers.Authorization).toBeUndefined()
  })

  it('devuelve el JSON parseado tal cual', async () => {
    respondWith({ id: 'u1', email: 'a@b.com' })

    await expect(getCurrentUser('tok')).resolves.toEqual({ id: 'u1', email: 'a@b.com' })
  })
})

describe('ApiError', () => {
  it('rescata el mensaje y el código que manda el backend', async () => {
    failWith(403, JSON.stringify({ message: 'AI metrics require Pro.', code: 'pro_required' }))

    const error = await captureApiError(getAiMetrics('tok', 'abc'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.name).toBe('ApiError')
    expect(error.message).toBe('AI metrics require Pro.')
    expect(error.code).toBe('pro_required')
    expect(error.status).toBe(403)
  })

  it('conserva el texto crudo cuando la respuesta no es JSON (proxy, 502)', async () => {
    failWith(502, '<html>Bad Gateway</html>')

    const error = await captureApiError(getCurrentUser('tok'))

    expect(error.message).toBe('<html>Bad Gateway</html>')
    expect(error.code).toBeUndefined()
    expect(error.status).toBe(502)
  })

  it('arma un mensaje genérico cuando el cuerpo viene vacío', async () => {
    failWith(500, '')

    const error = await captureApiError(getCurrentUser('tok'))

    expect(error.message).toBe('Request failed with status 500')
  })

  it('usa el texto crudo si el JSON no trae "message"', async () => {
    failWith(400, JSON.stringify({ code: 'invalid_request' }))

    const error = await captureApiError(getCurrentUser('tok'))

    expect(error.code).toBe('invalid_request')
    expect(error.message).toBe('{"code":"invalid_request"}')
  })
})

describe('autenticación', () => {
  it('manda el id token de Google', async () => {
    await loginWithGoogle('google-id-token')
    const { url, init } = lastCall()

    expect(url).toBe(`${BASE}/api/auth/google`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      idToken: 'google-id-token',
      recaptchaToken: undefined,
      recaptchaIsFallback: false,
    })
  })

  it('adjunta el token de reCAPTCHA y marca si es el fallback v2', async () => {
    await loginWithGoogle('google-id-token', { token: 'rc', isFallback: true })

    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      idToken: 'google-id-token',
      recaptchaToken: 'rc',
      recaptchaIsFallback: true,
    })
  })

  it('marca isFallback en false cuando no se aclara', async () => {
    await loginWithGoogle('google-id-token', { token: 'rc' })

    expect(JSON.parse(lastCall().init.body as string).recaptchaIsFallback).toBe(false)
  })
})

describe('análisis guardados', () => {
  it('lista con GET', async () => {
    respondWith([])
    await listAnalyses('tok')

    expect(lastCall().url).toBe(`${BASE}/api/analyses`)
    expect(lastCall().init.method).toBe('GET')
  })

  it('guarda con POST y el cuerpo completo', async () => {
    await saveAnalysis('tok', {
      chatName: 'Grupo',
      dateRangeLabel: '01 - 02',
      messageCount: 10,
      participantCount: 2,
      resultsJson: '{}',
      sourceHash: 'abc',
    })
    const { url, init } = lastCall()

    expect(url).toBe(`${BASE}/api/analyses`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).chatName).toBe('Grupo')
  })
})

describe('métricas con IA', () => {
  it('desenvuelve la lista de resultados', async () => {
    respondWith({ results: [{ metricId: 'redflags', status: 'ready' }] })

    await expect(analyzeAiMetrics('tok', { sourceHash: 'abc', metrics: [] })).resolves.toEqual([
      { metricId: 'redflags', status: 'ready' },
    ])
  })

  it('POST /api/ai/metrics manda los fragmentos', async () => {
    respondWith({ results: [] })
    await analyzeAiMetrics('tok', {
      sourceHash: 'abc',
      metrics: [{ metricId: 'redflags', snippets: [{ id: '1', keyword: 'celos', text: 'A: x' }] }],
    })

    expect(lastCall().url).toBe(`${BASE}/api/ai/metrics`)
    expect(JSON.parse(lastCall().init.body as string).metrics[0].snippets).toHaveLength(1)
  })

  it('el reintento sólo manda el hash del chat', async () => {
    respondWith({ results: [] })
    await retryAiMetrics('tok', 'abc')

    expect(lastCall().url).toBe(`${BASE}/api/ai/metrics/retry`)
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ sourceHash: 'abc' })
  })

  it('la lectura de veredictos escapa el hash en la query', async () => {
    respondWith({ results: [] })
    await getAiMetrics('tok', 'a b&c')

    expect(lastCall().url).toBe(`${BASE}/api/ai/metrics?sourceHash=a%20b%26c`)
    expect(lastCall().init.method).toBe('GET')
  })

  it('el consentimiento es un POST sin cuerpo', async () => {
    await grantAiConsent('tok')

    expect(lastCall().url).toBe(`${BASE}/api/ai/consent`)
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().init.body).toBeUndefined()
  })
})

describe('suscripciones', () => {
  it('la vista general viaja con el device id', async () => {
    localStorage.setItem('vistazo-device-id', 'device-abc')
    await getSubscription('tok')

    expect(lastCall().url).toBe(`${BASE}/api/subscription?deviceId=device-abc`)
  })

  it('el checkout manda el device id en el cuerpo y devuelve el init point', async () => {
    localStorage.setItem('vistazo-device-id', 'device-abc')
    respondWith({ initPoint: 'https://mp/checkout', subscriptionId: 'sub-1' })

    await expect(startCheckout('tok')).resolves.toEqual({
      initPoint: 'https://mp/checkout',
      subscriptionId: 'sub-1',
    })
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ deviceId: 'device-abc' })
  })

  it('cancelar y sincronizar son POST sin cuerpo', async () => {
    await cancelSubscription('tok')
    expect(lastCall().url).toBe(`${BASE}/api/subscription/cancel`)

    await syncSubscription('tok')
    expect(lastCall().url).toBe(`${BASE}/api/subscription/sync`)
    expect(lastCall().init.method).toBe('POST')
  })
})

describe('desbloqueos gratuitos', () => {
  it('consulta el saldo del día sin chat', async () => {
    await getFreeUnlocks('tok')

    expect(lastCall().url).toBe(`${BASE}/api/metric-unlocks`)
  })

  it('consulta el saldo para un chat concreto', async () => {
    await getFreeUnlocks('tok', 'abc/def')

    expect(lastCall().url).toBe(`${BASE}/api/metric-unlocks?sourceHash=abc%2Fdef`)
  })

  it('gastar un desbloqueo manda la métrica y el chat', async () => {
    await spendFreeUnlock('tok', 'spammer', 'abc')

    expect(lastCall().init.method).toBe('POST')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ metricId: 'spammer', sourceHash: 'abc' })
  })
})

describe('compartir', () => {
  it('publica el recorrido', async () => {
    respondWith({ slug: 'abc123', expiresAtUtc: '2025-06-01T00:00:00Z' })

    await expect(
      createShare('tok', {
        chatName: 'Grupo',
        dateRangeLabel: '01 - 02',
        sourceHash: 'abc',
        language: 'es',
        messageCount: 10,
        participantCount: 2,
        cardsJson: '[]',
      }),
    ).resolves.toEqual({ slug: 'abc123', expiresAtUtc: '2025-06-01T00:00:00Z' })
    expect(lastCall().url).toBe(`${BASE}/api/shares`)
  })

  it('la lectura pública escapa el slug', async () => {
    await getSharedStory('abc/../secreto')

    expect(lastCall().url).toBe(`${BASE}/api/shares/abc%2F..%2Fsecreto`)
  })
})

describe('rutas de desarrollo', () => {
  it('el toggle de suscripción es un POST', async () => {
    respondWith({ simulatedSubscriptionActive: true })

    await expect(toggleDevSubscription('tok')).resolves.toEqual({ simulatedSubscriptionActive: true })
    expect(lastCall().url).toBe(`${BASE}/api/dev/subscription/toggle`)
  })

  it('el reset de desbloqueos acepta un chat opcional', async () => {
    await resetDevFreeUnlocks('tok')
    expect(lastCall().url).toBe(`${BASE}/api/dev/free-unlocks/reset`)

    await resetDevFreeUnlocks('tok', 'abc')
    expect(lastCall().url).toBe(`${BASE}/api/dev/free-unlocks/reset?sourceHash=abc`)
  })
})

describe('URL base configurable', () => {
  it('usa VITE_API_URL cuando está definida', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.vistazo.app')
    vi.resetModules()

    const { getCurrentUser: freshGetCurrentUser } = await import('../api')
    await freshGetCurrentUser('tok')

    expect(lastCall().url).toBe('https://api.vistazo.app/api/auth/me')
  })
})
