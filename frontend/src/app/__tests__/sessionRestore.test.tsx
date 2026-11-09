import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { TooltipProvider } from '../../components/TooltipProvider'
import { shellCopy } from '../../copy/shellCopy'
import { ApiError, getCurrentUser, getFreeUnlocks, getSubscription, listAnalyses } from '../../lib/api'
import { landingPreviewInWorker } from '../../lib/analysisClient'
import { TERMS_VERSION } from '../../lib/terms'
import { stubIntersectionObserver, stubMatchMedia } from '../../test/setup'
import type { MetricCard, SavedAnalysis, SubscriptionOverview, UserProfile } from '../../types'

// Lo que se prueba acá es qué ve alguien que ya tiene sesión en los segundos que tarda el
// servidor en contestar, así que las dos respuestas (el perfil y el historial) son promesas
// que el test resuelve cuando quiere. Todo lo demás de la API queda como está.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  getCurrentUser: vi.fn(),
  listAnalyses: vi.fn(),
  getFreeUnlocks: vi.fn(),
  getSubscription: vi.fn(),
}))

// Sin Web Worker en jsdom: las tarjetas de ejemplo de la landing llegan por acá.
vi.mock('../../lib/analysisClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/analysisClient')>()),
  landingPreviewInWorker: vi.fn(),
}))

const copy = shellCopy.es

const TOKEN_KEY = 'wrapper-crm-auth-token'
const CACHED_USER_KEY = 'wrapper-crm-cached-user'

const profile: UserProfile = {
  id: 'user-1',
  email: 'santi@example.com',
  displayName: 'Santi',
  avatarUrl: null,
  isAdmin: false,
  hasUsedTrial: true,
  // Con Pro el desglose gratuito no se lee: una llamada menos que controlar.
  hasVipAccess: true,
  subscriptionState: 'activa',
  hasAiConsent: true,
  hasAiProfileConsent: true,
  aiEnabled: true,
  paymentsEnabled: true,
  checkoutTestPayerEmail: null,
  preferredLanguage: 'es',
  acceptedTermsVersion: TERMS_VERSION,
}

const savedChat: SavedAnalysis = {
  id: 'analysis-1',
  chatName: 'Grupo del asado',
  dateRangeLabel: '1 ene – 30 jun',
  messageCount: 1234,
  participantCount: 4,
  resultsJson: '{}',
  sourceHash: 'hash-1',
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-02T00:00:00Z',
}

// Lo mínimo que dibuja el carrusel de ejemplos de la landing.
const demoCard = {
  id: 'demo-1',
  title: 'Quién escribe más',
  accent: 'accent-a',
  tier: 'free',
  basic: { value: '42%', label: 'de los mensajes' },
} as unknown as MetricCard

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** La app con lo que `main.tsx` le pone alrededor. */
function renderApp() {
  return render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  )
}

/** Lo que había en el navegador cuando se refrescó la página. */
function reload({ cachedProfile }: { cachedProfile: boolean }) {
  localStorage.setItem(TOKEN_KEY, 'token-de-prueba')
  if (cachedProfile) {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(profile))
  }
  return renderApp()
}

let me: Deferred<UserProfile>
let list: Deferred<SavedAnalysis[]>

/** El servidor contesta las dos cosas a la vez, como en producción. */
async function serverAnswers(answer: { me?: UserProfile; list?: SavedAnalysis[] }) {
  await act(async () => {
    me.resolve(answer.me ?? profile)
    list.resolve(answer.list ?? [])
  })
}

beforeEach(() => {
  stubIntersectionObserver()
  me = deferred<UserProfile>()
  list = deferred<SavedAnalysis[]>()
  vi.mocked(getCurrentUser).mockReturnValue(me.promise)
  vi.mocked(listAnalyses).mockReturnValue(list.promise)
  vi.mocked(getFreeUnlocks).mockRejectedValue(new Error('no debería pedirse con Pro'))
  vi.mocked(getSubscription).mockResolvedValue(null as unknown as SubscriptionOverview)
  vi.mocked(landingPreviewInWorker).mockResolvedValue([])
})

describe('refrescar la página con sesión — desktop', () => {
  it('pinta la cuenta guardada y un esqueleto del historial, sin decir que no hay análisis', () => {
    reload({ cachedProfile: true })

    // La cuenta está desde el primer cuadro, sin esperar a /api/auth/me.
    expect(screen.getByRole('button', { name: copy.account })).toHaveTextContent('S')
    expect(screen.queryByText(copy.login)).not.toBeInTheDocument()

    // El historial todavía no llegó: se sabe que viene, no que esté vacío.
    expect(screen.getByRole('status', { name: copy.savedLoading })).toBeInTheDocument()
    expect(screen.queryByText(copy.noSaved)).not.toBeInTheDocument()
  })

  it('cuando llega el historial reemplaza el esqueleto por los análisis', async () => {
    reload({ cachedProfile: true })

    await serverAnswers({ list: [savedChat] })

    expect(await screen.findByText('Grupo del asado')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.savedLoading })).not.toBeInTheDocument()
    expect(screen.queryByText(copy.noSaved)).not.toBeInTheDocument()
  })

  it('sólo dice que no hay análisis cuando el servidor contestó que no hay', async () => {
    reload({ cachedProfile: true })

    await serverAnswers({ list: [] })

    expect(await screen.findByText(copy.noSaved)).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.savedLoading })).not.toBeInTheDocument()
  })

  it('si la lista no llega (sin red) deja de esperarla y la sesión sigue en pie', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    reload({ cachedProfile: true })

    await act(async () => {
      me.resolve(profile)
      list.reject(new Error('sin red'))
    })

    expect(await screen.findByText(copy.noSaved)).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.savedLoading })).not.toBeInTheDocument()
    // Un fallo de red no es un rechazo de identidad: nadie queda deslogueado por eso.
    expect(localStorage.getItem(TOKEN_KEY)).toBe('token-de-prueba')
    expect(screen.getByRole('button', { name: copy.account })).toBeInTheDocument()
  })

  it('el perfil que contesta el servidor pisa al guardado y queda guardado para el próximo arranque', async () => {
    reload({ cachedProfile: true })
    expect(screen.getByRole('button', { name: copy.account })).toHaveTextContent('S')

    await serverAnswers({ me: { ...profile, displayName: 'Martina' } })

    await waitFor(() => expect(screen.getByRole('button', { name: copy.account })).toHaveTextContent('M'))
    expect(JSON.parse(localStorage.getItem(CACHED_USER_KEY) ?? '{}')).toMatchObject({ displayName: 'Martina' })
  })

  it('con token pero sin perfil guardado no muestra la landing de visitante ni "Iniciar sesión"', async () => {
    reload({ cachedProfile: false })

    // El header reserva el lugar de la cuenta y el cuerpo espera con el esqueleto: la
    // landing y el botón de entrar son la imagen de "no estoy logueado" que se evita.
    expect(document.querySelector('.account-placeholder')).toBeInTheDocument()
    expect(screen.queryByText(copy.login)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.landingSubtitle)).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: copy.savedLoading })).toBeInTheDocument()

    await serverAnswers({ list: [savedChat] })

    expect(await screen.findByText('Grupo del asado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: copy.account })).toBeInTheDocument()
    // Y el perfil queda guardado: el próximo arranque ya no pasa por acá.
    expect(JSON.parse(localStorage.getItem(CACHED_USER_KEY) ?? '{}')).toMatchObject({ id: 'user-1' })
  })

  it('un 401 de /me cierra la sesión: borra token y perfil guardado y vuelve la landing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    reload({ cachedProfile: true })

    await act(async () => {
      me.reject(new ApiError('Unauthorized', 401))
      list.resolve([])
    })

    expect(await screen.findByText(copy.login)).toBeInTheDocument()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(CACHED_USER_KEY)).toBeNull()
    expect(screen.queryByRole('status', { name: copy.savedLoading })).not.toBeInTheDocument()
  })

  it('cerrar sesión borra el perfil guardado, para que el próximo arranque no pinte a nadie', async () => {
    reload({ cachedProfile: true })
    await serverAnswers({ list: [savedChat] })
    await screen.findByText('Grupo del asado')

    fireEvent.click(screen.getByRole('button', { name: copy.logout }))

    expect(await screen.findByText(copy.login)).toBeInTheDocument()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(CACHED_USER_KEY)).toBeNull()
  })

  it('un perfil guardado sin token no se usa: es de una sesión que ya no existe', () => {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(profile))

    renderApp()

    expect(screen.getByText(copy.login)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.account })).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.savedLoading })).not.toBeInTheDocument()
    expect(localStorage.getItem(CACHED_USER_KEY)).toBeNull()
    expect(getCurrentUser).not.toHaveBeenCalled()
  })

  it('sin sesión no se espera nada: es la landing de siempre', () => {
    renderApp()

    expect(screen.getByText(copy.login)).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.savedLoading })).not.toBeInTheDocument()
    expect(listAnalyses).not.toHaveBeenCalled()
  })
})

describe('refrescar la página con sesión — celular', () => {
  beforeEach(() => {
    // La misma media query que elige el shell de mobile en `useIsMobile`.
    stubMatchMedia(() => true)
    vi.mocked(landingPreviewInWorker).mockResolvedValue([demoCard])
  })

  it('el Inicio no adelanta los ejemplos mientras no se sabe si hay chats guardados', async () => {
    reload({ cachedProfile: true })

    // Los ejemplos ya están calculados, pero son para quien no tiene nada: mostrarlos
    // y a los dos segundos cambiarlos por los chats de siempre es lo que parecía no
    // estar logueado.
    expect(await screen.findByRole('status', { name: copy.savedLoading })).toBeInTheDocument()
    expect(screen.queryByText(copy.examplesTitle)).not.toBeInTheDocument()
    // El avatar de la cuenta (y no el lugar reservado) ya está arriba.
    expect(document.querySelector('button.m-avatar')).toHaveTextContent('S')

    await serverAnswers({ list: [savedChat] })

    expect(await screen.findByText('Grupo del asado')).toBeInTheDocument()
    expect(screen.getByText(copy.mobile.home.recent)).toBeInTheDocument()
    expect(screen.queryByText(copy.examplesTitle)).not.toBeInTheDocument()
  })

  it('el Inicio muestra los ejemplos recién cuando se confirma que no hay chats', async () => {
    reload({ cachedProfile: true })
    await screen.findByRole('status', { name: copy.savedLoading })

    await serverAnswers({ list: [] })

    expect(await screen.findByText(copy.examplesTitle)).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.savedLoading })).not.toBeInTheDocument()
  })

  it('el Historial espera la lista en vez de ofrecer entrar o decir que está vacío', async () => {
    reload({ cachedProfile: true })

    fireEvent.click(screen.getByRole('button', { name: copy.mobile.tabs.history }))

    expect(screen.getByRole('status', { name: copy.savedLoading })).toBeInTheDocument()
    expect(screen.queryByText(copy.noSaved)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.savePromptTitle)).not.toBeInTheDocument()

    await serverAnswers({ list: [savedChat] })

    expect(await screen.findByText('Grupo del asado')).toBeInTheDocument()
  })

  it('con token y sin perfil guardado el Historial tampoco ofrece "Iniciar sesión"', async () => {
    reload({ cachedProfile: false })

    fireEvent.click(screen.getByRole('button', { name: copy.mobile.tabs.history }))

    expect(screen.getByRole('status', { name: copy.savedLoading })).toBeInTheDocument()
    expect(screen.queryByText(copy.savePromptTitle)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.login)).not.toBeInTheDocument()

    await serverAnswers({ list: [] })

    expect(await screen.findByText(copy.noSaved)).toBeInTheDocument()
  })

  it('con token y sin perfil guardado la Cuenta y el menú reservan el lugar sin ofrecer entrar', () => {
    reload({ cachedProfile: false })

    fireEvent.click(screen.getByRole('button', { name: copy.mobile.tabs.account }))

    expect(screen.queryByText(copy.vipPopover.signInCta)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: copy.mobile.openMenu }))

    expect(screen.queryByText(copy.savePromptTitle)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.login)).not.toBeInTheDocument()
  })

  it('sin sesión el Inicio muestra los ejemplos de entrada: no hay nada que esperar', async () => {
    renderApp()

    expect(await screen.findByText(copy.examplesTitle)).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.savedLoading })).not.toBeInTheDocument()
  })
})
