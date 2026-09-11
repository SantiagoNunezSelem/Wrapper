import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminCopy } from '../../copy/adminCopy'
import type { UserProfile } from '../../types'
import type {
  AdminAccess,
  AdminAiReport,
  AdminBusiness,
  AdminInvoicePage,
  AdminProductReport,
  AdminSystemReport,
  AdminUrgencies,
  AdminUserDetail,
  AdminUserPage,
} from '../types'

vi.mock('../adminApi', () => ({
  getAdminBusiness: vi.fn(),
  getAdminUrgencies: vi.fn(),
  searchAdminUsers: vi.fn(),
  getAdminUser: vi.fn(),
  syncAdminUser: vi.fn(),
  addAdminNote: vi.fn(),
  grantAdminVip: vi.fn(),
  revokeAdminVip: vi.fn(),
  grantAdminTrial: vi.fn(),
  getAdminInvoices: vi.fn(),
  getAdminAi: vi.fn(),
  getAdminProduct: vi.fn(),
  getAdminSystem: vi.fn(),
  getAdminExport: vi.fn(),
}))

// jsdom no baja archivos: lo que importa es qué recibe quien los guarda.
vi.mock('../download', () => ({ saveFile: vi.fn() }))

import * as api from '../adminApi'
import { AdminApp } from '../AdminApp'
import { saveFile } from '../download'

const copy = adminCopy.es

const HOUR = 3_600_000

const admin: UserProfile = {
  id: 'admin-1',
  email: 'selemsantiago@gmail.com',
  displayName: 'Santi',
  avatarUrl: null,
  isAdmin: true,
  hasUsedTrial: false,
  hasVipAccess: true,
  subscriptionState: 'activa',
  hasAiConsent: false,
  aiEnabled: true,
  paymentsEnabled: true,
  checkoutTestPayerEmail: null,
  preferredLanguage: 'es',
}

const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']

const business: AdminBusiness = {
  days: 30,
  registeredUsers: 1284,
  newUsers: 86,
  newUsersPrevious: 70,
  proActive: 57,
  inTrial: 14,
  newPro: 9,
  monthlyRecurringRevenue: 444600,
  trialConversion: 0.38,
  trialConversionPrevious: 0.42,
  signupsByDay: Array.from({ length: 30 }, (_, index) => index % 4),
  collectedByMonth: months.map((month, index) => ({ month, amount: (index + 1) * 70000 })),
  latestSubscriptions: [{ userId: 'u-1', email: 'lucia@example.com', status: 'activa', amount: 7800, currencyId: 'ARS', createdAtUtc: '2026-09-10T12:00:00Z' }],
  activeUsers7: 412,
  activeUsers30: 803,
  aiInputTokensMonth: 1_200_000,
  aiOutputTokensMonth: 300_000,
  aiCostMonthUsd: 0.24,
  funnel: { registered: 86, savedAnalysis: 41, openedCheckout: 12, paid: 9 },
  proMovements: months.map((month, index) => ({ month, started: index, cancelled: index > 3 ? 1 : 0 })),
}

const urgencies: AdminUrgencies = {
  items: [
    { kind: 'orphan_payment', severity: 'critical', atUtc: '2026-09-10T11:00:00Z', count: 1, userId: null, userEmail: null, reference: '7f3c', detail: 'subscription_preapproval', deadlineUtc: null },
    { kind: 'payment_failed', severity: 'warning', atUtc: '2026-09-09T12:00:00Z', count: 1, userId: 'u-2', userEmail: 'martin@example.com', reference: 'pre-2', detail: 'cc_rejected_insufficient_amount', deadlineUtc: '2026-09-12T12:00:00Z' },
    { kind: 'trial_blocked', severity: 'info', atUtc: '2026-09-10T10:00:00Z', count: 5, userId: null, userEmail: null, reference: null, detail: 'device_used', deadlineUtc: null },
    { kind: 'trial_ending', severity: 'info', atUtc: '2026-09-10T09:00:00Z', count: 1, userId: 'u-3', userEmail: 'ana@example.com', reference: 'pre-3', detail: null, deadlineUtc: new Date(Date.now() + 20 * HOUR).toISOString() },
  ],
  health: {
    instanceStartedAtUtc: '2026-09-10T00:00:00Z',
    notificationsReceived: 142,
    notificationsAccepted: 139,
    notificationsRejected: 3,
    lastAcceptedAtUtc: '2026-09-10T11:56:00Z',
    reconcileIntervalMinutes: 15,
    webhookSecretConfigured: true,
    usingTestCredentials: false,
    testPayerEmail: 'test_user_1@testuser.com',
    sellerNickname: 'VISTAZO_SELLER',
    rejectedLastDay: 2,
  },
}

const page: AdminUserPage = {
  total: 1,
  page: 1,
  pageSize: 20,
  items: [{ id: 'u-2', email: 'martin@example.com', displayName: 'Martín Rodríguez', createdAtUtc: '2026-06-02T12:00:00Z', state: 'pago_fallido', isAdmin: false }],
}

/** La cuenta de la ficha: Pro por una suscripción que Mercado Pago sigue cobrando. */
const baseAccess: AdminAccess = {
  source: 'subscription',
  courtesyUntilUtc: null,
  canGrantVip: false,
  grantVipBlockedReason: 'paid_active',
  canRevokeVip: true,
  revokeCancelsBilling: true,
  trialState: 'used',
  trialGrantedAtUtc: null,
  canGrantTrial: true,
}

const noAccess: AdminAccess = {
  ...baseAccess,
  source: 'none',
  canGrantVip: true,
  grantVipBlockedReason: null,
  canRevokeVip: false,
  revokeCancelsBilling: false,
}

const detail: AdminUserDetail = {
  id: 'u-2',
  email: 'martin@example.com',
  displayName: 'Martín Rodríguez',
  preferredLanguage: 'es',
  createdAtUtc: '2026-06-02T12:00:00Z',
  isAdmin: false,
  hasUsedTrial: true,
  aiConsentAtUtc: '2026-06-02T12:00:00Z',
  state: 'pago_fallido',
  hasProAccess: true,
  current: {
    id: 's-1',
    status: 'pago_fallido',
    planType: 'mensual',
    amount: 7800,
    currencyId: 'ARS',
    paymentMethodLabel: 'account_money',
    externalSubscriptionId: '5c829b89',
    lastPaymentStatusDetail: 'cc_rejected_insufficient_amount',
    trialEndsAtUtc: null,
    nextBillingAtUtc: '2026-09-11T12:00:00Z',
    graceEndsAtUtc: '2026-09-12T12:00:00Z',
    cancelledAtUtc: null,
    lastSyncedAtUtc: '2026-09-10T11:57:00Z',
    createdAtUtc: '2026-06-02T12:00:00Z',
    isSeededVip: false,
    isDevSimulated: false,
    accessRevokedAtUtc: null,
  },
  subscriptions: [],
  invoices: [{ id: 'i-1', status: 'rechazado', statusDetail: 'cc_rejected_insufficient_amount', amount: 7800, currencyId: 'ARS', paidAtUtc: null, debitScheduledAtUtc: '2026-09-09T12:00:00Z', createdAtUtc: '2026-09-09T12:00:00Z', attemptNumber: 1 }],
  events: [{ id: 'e-1', topic: 'subscription_authorized_payment', action: 'created', resultingStatus: 'pago_fallido', notes: 'rejected/cc_rejected_insufficient_amount · activa → pago_fallido', createdAtUtc: '2026-09-09T12:02:00Z' }],
  usage: { savedAnalyses: 6, sharedStories: 2, aiMetrics: 11, aiMetricsFailed: 1, freeUnlocks: 3, trialClaims: 1, trialCountries: ['AR'], aiTokens: 48_000 },
  lastSeenAtUtc: new Date(Date.now() - 3 * HOUR).toISOString(),
  notes: [{ id: 'n-1', authorEmail: 'admin@example.com', text: 'Pidió factura.', createdAtUtc: '2026-09-09T12:00:00Z' }],
  access: baseAccess,
}

/** La misma cuenta, sin Pro y sin suscripción. */
function withoutPro(access: Partial<AdminAccess> = {}): AdminUserDetail {
  return { ...detail, state: 'inactiva', hasProAccess: false, current: null, subscriptions: [], access: { ...noAccess, ...access } }
}

const invoices: AdminInvoicePage = {
  total: 2,
  page: 1,
  pageSize: 25,
  items: [
    { id: 'i-1', userId: 'u-2', email: 'martin@example.com', status: 'rechazado', statusDetail: 'cc_rejected_insufficient_amount', amount: 7800, currencyId: 'ARS', paidAtUtc: null, debitScheduledAtUtc: '2026-09-09T12:00:00Z', createdAtUtc: '2026-09-09T12:00:00Z', attemptNumber: 2 },
    { id: 'i-2', userId: 'u-1', email: 'lucia@example.com', status: 'aprobado', statusDetail: null, amount: 7800, currencyId: 'ARS', paidAtUtc: '2026-09-02T12:00:00Z', debitScheduledAtUtc: null, createdAtUtc: '2026-09-02T12:00:00Z', attemptNumber: 1 },
  ],
  countsByStatus: { aprobado: 1, rechazado: 1 },
  approvedThisMonth: 7800,
}

const ai: AdminAiReport = {
  days: 30,
  tracked: true,
  model: 'gemini-3.1-flash-lite',
  pricesConfigured: false,
  inputTokens: 1_200_000,
  outputTokens: 300_000,
  costUsd: null,
  tokensByDay: Array.from({ length: 30 }, (_, index) => (index % 3) * 1000),
  byMetric: [{ metricId: 'tonopicante', calls: 40, failedCalls: 3, inputTokens: 900_000, outputTokens: 200_000 }],
  errorsByCode: [{ key: 'blocked', count: 3 }],
}

const product: AdminProductReport = {
  days: 30,
  analysesByDay: Array.from({ length: 30 }, (_, index) => index % 2),
  topUnlocked: [{ key: 'ghosting', count: 12 }],
  topAiMetrics: [{ key: 'redflags', count: 5 }],
  sharedInPeriod: 4,
  liveShares: 9,
  liveShareViews: 120,
}

const system: AdminSystemReport = {
  environment: 'Production',
  version: 'abc1234',
  startedAtUtc: '2026-09-10T08:00:00Z',
  integrations: [
    { key: 'mercadopago', state: 'warn', value: 'TESTUSER4000' },
    { key: 'webhook_secret', state: 'ok', value: null },
    { key: 'ai_prices', state: 'off', value: null },
  ],
  trialDenials30d: [{ key: 'device_used', count: 4 }],
  audit: [
    { id: 'a-1', adminEmail: 'admin@example.com', action: 'export_users', targetUserId: null, details: null, createdAtUtc: '2026-09-10T10:00:00Z' },
    { id: 'a-2', adminEmail: 'admin@example.com', action: 'sync', targetUserId: 'u-2', details: null, createdAtUtc: '2026-09-10T09:00:00Z' },
  ],
}

function renderAdmin(path: string, props: Partial<Parameters<typeof AdminApp>[0]> = {}) {
  window.history.replaceState(null, '', path)
  return render(<AdminApp token="token" user={admin} language="es" onToggleLanguage={vi.fn()} {...props} />)
}

beforeEach(() => {
  vi.mocked(api.getAdminBusiness).mockResolvedValue(business)
  vi.mocked(api.getAdminUrgencies).mockResolvedValue(urgencies)
  vi.mocked(api.searchAdminUsers).mockResolvedValue(page)
  vi.mocked(api.getAdminUser).mockResolvedValue(detail)
  vi.mocked(api.syncAdminUser).mockResolvedValue({ ...detail, state: 'activa', current: { ...detail.current!, status: 'activa' } })
  vi.mocked(api.getAdminInvoices).mockResolvedValue(invoices)
  vi.mocked(api.getAdminAi).mockResolvedValue(ai)
  vi.mocked(api.getAdminProduct).mockResolvedValue(product)
  vi.mocked(api.getAdminSystem).mockResolvedValue(system)
})

afterEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('AdminApp · acceso al panel', () => {
  it('sin sesión pide iniciarla', () => {
    renderAdmin('/admin', { token: null, user: null })
    expect(screen.getByText(copy.signInFirst)).toBeInTheDocument()
  })

  it('mientras llega la cuenta, espera', () => {
    renderAdmin('/admin', { user: null })
    expect(screen.getByText(copy.loading)).toBeInTheDocument()
  })

  it('una cuenta común no ve el panel', () => {
    renderAdmin('/admin', { user: { ...admin, isAdmin: false } })
    expect(screen.getByText(copy.forbidden)).toBeInTheDocument()
    expect(api.getAdminBusiness).not.toHaveBeenCalled()
  })

  it('el menú tiene las siete secciones', async () => {
    renderAdmin('/admin')
    await screen.findByText('1.284')

    for (const label of Object.values(copy.nav)) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})

describe('AdminApp · Negocio', () => {
  it('muestra las cifras, los activos, el gasto de IA y el embudo', async () => {
    renderAdmin('/admin')

    expect(await screen.findByText('1.284')).toBeInTheDocument()
    expect(screen.getByText('57')).toBeInTheDocument()
    // Según la versión de ICU, Intl pega el signo al número o lo separa con un espacio duro.
    expect(screen.getByText(/^38\s?%$/)).toBeInTheDocument()
    expect(screen.getByText('412')).toBeInTheDocument()
    expect(screen.getByText('803')).toBeInTheDocument()
    expect(screen.getByText(/^US\$\s?0,24$/)).toBeInTheDocument()
    expect(screen.getByText(/^9 · 10\s?%$/)).toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(api.getAdminBusiness).toHaveBeenCalledWith('token', 30)
  })

  it('lo que todavía no se registra lo dice, en vez de mostrar ceros', async () => {
    vi.mocked(api.getAdminBusiness).mockResolvedValueOnce({
      ...business,
      activeUsers7: null,
      activeUsers30: null,
      aiInputTokensMonth: 0,
      aiOutputTokensMonth: 0,
      aiCostMonthUsd: null,
    })
    renderAdmin('/admin')

    expect(await screen.findByText('1.284')).toBeInTheDocument()
    expect(screen.getAllByText(copy.noData)).toHaveLength(3)
    expect(screen.getAllByText(copy.business.activeSince)).toHaveLength(2)
    expect(screen.getByText(copy.aiPrices.missing)).toBeInTheDocument()
  })

  it('cambiar el período vuelve a pedir con esa ventana', async () => {
    renderAdmin('/admin')
    await screen.findByText('1.284')

    await userEvent.click(screen.getByRole('button', { name: copy.periods[7] }))

    await waitFor(() => expect(api.getAdminBusiness).toHaveBeenLastCalledWith('token', 7))
  })

  it('una columna enfocada muestra su valor', async () => {
    renderAdmin('/admin')
    await screen.findByText('1.284')

    const column = screen.getByLabelText(copy.business.signupsTip.replace('{n}', '1').replace('{when}', copy.daysAgo.replace('{n}', '28')))
    fireEvent.focus(column)

    expect(screen.getByRole('status')).toHaveTextContent('1 altas')
  })

  it('un error se puede reintentar', async () => {
    vi.mocked(api.getAdminBusiness).mockRejectedValueOnce(new Error('caído'))
    renderAdmin('/admin')

    await userEvent.click(await screen.findByRole('button', { name: copy.retry }))

    expect(await screen.findByText('1.284')).toBeInTheDocument()
  })
})

describe('AdminApp · Urgencias', () => {
  it('ordena por gravedad, filtra y muestra la salud de pagos', async () => {
    renderAdmin('/admin/urgencias')

    expect(await screen.findByText(copy.urgencies.kinds.orphan_payment)).toBeInTheDocument()
    expect(screen.getByText('5 trials frenados: mismo dispositivo que otra cuenta')).toBeInTheDocument()
    expect(screen.getByText('test_user_1@testuser.com')).toBeInTheDocument()
    expect(screen.getByText('VISTAZO_SELLER')).toBeInTheDocument()
    expect(screen.getByText('▲ 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: `${copy.urgencies.severity.warning} · 1` }))

    expect(screen.queryByText(copy.urgencies.kinds.orphan_payment)).not.toBeInTheDocument()
    expect(screen.getByText(copy.urgencies.kinds.payment_failed)).toBeInTheDocument()
  })

  it('"Ver ficha" lleva a la cuenta', async () => {
    renderAdmin('/admin/urgencias')

    const [first] = await screen.findAllByRole('button', { name: copy.urgencies.openUser })
    await userEvent.click(first)

    expect(window.location.pathname).toBe('/admin/usuarios/u-2')
    expect(await screen.findByRole('heading', { name: 'Martín Rodríguez' })).toBeInTheDocument()
    expect(api.getAdminUser).toHaveBeenCalledWith('token', 'u-2')
  })

  it('un trial por vencer dice de quién es y cuándo vence', async () => {
    renderAdmin('/admin/urgencias')

    expect(await screen.findByText(copy.urgencies.kinds.trial_ending)).toBeInTheDocument()
    expect(screen.getByText(/^ana@example\.com · vence /)).toBeInTheDocument()
  })
})

describe('AdminApp · robustez', () => {
  it('una ficha con la moneda en null se dibuja igual', async () => {
    // Era la ficha del admin: su VIP sembrado es anterior a la columna de moneda, y la
    // pantalla quedaba en blanco.
    vi.mocked(api.getAdminUser).mockResolvedValueOnce({
      ...detail,
      current: { ...detail.current!, currencyId: null as unknown as string, amount: 0 },
    })
    renderAdmin('/admin/usuarios/u-2')

    expect(await screen.findByRole('heading', { name: 'Martín Rodríguez' })).toBeInTheDocument()
    expect(screen.getByText(/^mensual · \$\s?0$/)).toBeInTheDocument()
  })

  it('si una sección se rompe, avisa y el menú sigue andando', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(api.getAdminBusiness).mockResolvedValueOnce({ ...business, signupsByDay: null as unknown as number[] })
    renderAdmin('/admin')

    expect(await screen.findByText(copy.sectionCrashed)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: copy.nav.urgencias }))

    expect(await screen.findByText(copy.urgencies.kinds.orphan_payment)).toBeInTheDocument()
    quiet.mockRestore()
  })

  it('sin datos, los gráficos lo dicen en vez de dibujar ceros', async () => {
    vi.mocked(api.getAdminBusiness).mockResolvedValueOnce({
      ...business,
      newUsers: 0,
      signupsByDay: Array.from({ length: 30 }, () => 0),
      collectedByMonth: business.collectedByMonth.map((item) => ({ ...item, amount: 0 })),
    })
    renderAdmin('/admin')

    expect(await screen.findByText(copy.business.signupsEmpty)).toBeInTheDocument()
    expect(screen.getByText(copy.business.collectedEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: copy.business.collectedTitle })).not.toBeInTheDocument()
  })

  it('las altas se comparan con el período previo con los dos números a la vista', async () => {
    renderAdmin('/admin')

    expect(await screen.findByText('86 altas en 30 días · 70 en los 30 previos')).toBeInTheDocument()
  })
})

describe('AdminApp · Usuarios', () => {
  it('busca mientras se escribe, sin una consulta por tecla', async () => {
    renderAdmin('/admin/usuarios')
    await screen.findByText('Martín Rodríguez')

    await userEvent.type(screen.getByRole('searchbox', { name: copy.users.searchLabel }), 'martin')

    await waitFor(() => expect(api.searchAdminUsers).toHaveBeenLastCalledWith('token', 'martin', 1))
    expect(vi.mocked(api.searchAdminUsers).mock.calls.length).toBeLessThan(6)
  })

  it('la ficha cuenta la actividad en castellano y guarda el detalle técnico aparte', async () => {
    renderAdmin('/admin/usuarios/u-2')

    expect(await screen.findByText('Dinero en cuenta')).toBeInTheDocument()
    expect(screen.getByText(copy.events.paymentRejected)).toBeInTheDocument()
    expect(screen.queryByText(/rejected\/cc_rejected_insufficient_amount/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: copy.users.showTech }))

    expect(screen.getByText(/rejected\/cc_rejected_insufficient_amount/)).toBeInTheDocument()
  })

  it('la ficha muestra el último ingreso, los tokens de IA y las notas', async () => {
    renderAdmin('/admin/usuarios/u-2')

    expect(await screen.findByText('Pidió factura.')).toBeInTheDocument()
    expect(screen.getByText(/^Último ingreso /)).toBeInTheDocument()
    expect(screen.getByText(/^48\s?(mil|k)$/)).toBeInTheDocument()
  })

  it('una nota nueva se guarda recortada y queda arriba de las anteriores', async () => {
    vi.mocked(api.addAdminNote).mockResolvedValueOnce({
      id: 'n-2',
      authorEmail: 'admin@example.com',
      text: 'Avisó que pagó por transferencia.',
      createdAtUtc: new Date().toISOString(),
    })
    renderAdmin('/admin/usuarios/u-2')
    await screen.findByText('Pidió factura.')
    const save = screen.getByRole('button', { name: copy.users.addNote })
    expect(save).toBeDisabled()

    const box = screen.getByRole('textbox', { name: copy.users.noteLabel })
    await userEvent.type(box, '  Avisó que pagó por transferencia.  ')
    await userEvent.click(save)

    expect(api.addAdminNote).toHaveBeenCalledWith('token', 'u-2', 'Avisó que pagó por transferencia.')
    const notes = screen.getByRole('heading', { name: copy.users.notes }).closest('section')!
    await waitFor(() => expect(within(notes).getAllByRole('listitem')[0]).toHaveTextContent('Avisó que pagó por transferencia.'))
    expect(within(notes).getAllByRole('listitem')).toHaveLength(2)
    expect(box).toHaveValue('')
  })

  it('si la nota no se guarda, lo dice y conserva lo escrito', async () => {
    vi.mocked(api.addAdminNote).mockRejectedValueOnce(new Error('No se pudo guardar.'))
    renderAdmin('/admin/usuarios/u-2')
    await screen.findByText('Pidió factura.')

    const box = screen.getByRole('textbox', { name: copy.users.noteLabel })
    await userEvent.type(box, 'hola')
    await userEvent.click(screen.getByRole('button', { name: copy.users.addNote }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar.')
    expect(box).toHaveValue('hola')
  })

  it('consultar a Mercado Pago reemplaza la ficha con lo que devuelve', async () => {
    renderAdmin('/admin/usuarios/u-2')
    const who = await screen.findByRole('heading', { name: 'Martín Rodríguez' })

    await userEvent.click(screen.getByRole('button', { name: copy.users.sync }))

    expect(api.syncAdminUser).toHaveBeenCalledWith('token', 'u-2')
    await waitFor(() => expect(within(who.closest('section')!).getByText(copy.statuses.activa)).toBeInTheDocument())
  })

  it('si Mercado Pago no responde, lo dice sin perder la ficha', async () => {
    vi.mocked(api.syncAdminUser).mockRejectedValueOnce(new Error('Mercado Pago no respondió.'))
    renderAdmin('/admin/usuarios/u-2')
    await screen.findByRole('heading', { name: 'Martín Rodríguez' })

    await userEvent.click(screen.getByRole('button', { name: copy.users.sync }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Mercado Pago no respondió.')
    expect(screen.getByRole('heading', { name: 'Martín Rodríguez' })).toBeInTheDocument()
  })

  it('exportar usuarios baja un CSV con la fecha en el nombre', async () => {
    const file = new Blob(['id,email'], { type: 'text/csv' })
    vi.mocked(api.getAdminExport).mockResolvedValueOnce(file)
    renderAdmin('/admin/usuarios')
    await screen.findByText('Martín Rodríguez')

    await userEvent.click(screen.getByRole('button', { name: copy.exportCsv }))

    expect(api.getAdminExport).toHaveBeenCalledWith('token', 'users')
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(file, expect.stringMatching(/^vistazo-usuarios-\d{4}-\d{2}-\d{2}\.csv$/)))
  })

  it('si exportar falla, lo dice al lado del botón', async () => {
    vi.mocked(api.getAdminExport).mockRejectedValueOnce(new Error('caído'))
    renderAdmin('/admin/usuarios')
    await screen.findByText('Martín Rodríguez')

    await userEvent.click(screen.getByRole('button', { name: copy.exportCsv }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.exportFailed)
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('el menú lateral cambia de sección y deja la URL', async () => {
    renderAdmin('/admin/usuarios')
    await screen.findByText(copy.users.pick)

    await userEvent.click(screen.getByRole('button', { name: copy.nav.negocio }))

    expect(window.location.pathname).toBe('/admin')
    expect(await screen.findByText('1.284')).toBeInTheDocument()
  })
})

describe('AdminApp · Acceso de una cuenta', () => {
  it('con una suscripción que cobra, quitar VIP avisa que la cancela en Mercado Pago', async () => {
    vi.mocked(api.revokeAdminVip).mockResolvedValueOnce({
      ...detail,
      state: 'cancelada',
      hasProAccess: false,
      current: { ...detail.current!, status: 'cancelada', accessRevokedAtUtc: '2026-09-11T12:00:00Z' },
      access: noAccess,
    })
    renderAdmin('/admin/usuarios/u-2')

    expect(await screen.findByText(copy.users.accessSubscription)).toBeInTheDocument()
    // Dar VIP encima de esa suscripción no frenaría los cobros: no se ofrece, y se dice por qué.
    expect(screen.getByText(copy.users.grantVipBlocked.paid_active)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.users.grantVip })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: copy.users.revokeVip }))
    expect(screen.getByText(copy.users.revokeVipConfirmBilling)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: copy.users.confirm }))

    expect(api.revokeAdminVip).toHaveBeenCalledWith('token', 'u-2')
    expect(await screen.findByText(copy.users.accessNone)).toBeInTheDocument()
    expect(screen.getByText(copy.users.revokedAt)).toBeInTheDocument()
    expect(screen.queryByText(copy.users.revokeVipConfirmBilling)).not.toBeInTheDocument()
  })

  it('da VIP con la duración elegida', async () => {
    vi.mocked(api.getAdminUser).mockResolvedValueOnce(withoutPro())
    vi.mocked(api.grantAdminVip).mockResolvedValueOnce({
      ...withoutPro({ source: 'courtesy', courtesyUntilUtc: '2026-12-10T12:00:00Z', canRevokeVip: true }),
      hasProAccess: true,
      state: 'activa',
    })
    renderAdmin('/admin/usuarios/u-2')

    expect(await screen.findByText(copy.users.accessNone)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '90 días' }))
    await userEvent.click(screen.getByRole('button', { name: copy.users.grantVip }))
    expect(screen.getByText(/: 90 días\. /)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: copy.users.confirm }))

    expect(api.grantAdminVip).toHaveBeenCalledWith('token', 'u-2', 90)
    expect(await screen.findByText(/^Tiene Pro de regalo hasta el /)).toBeInTheDocument()
  })

  it('sin vencimiento hay que elegirlo, y así se pide', async () => {
    vi.mocked(api.getAdminUser).mockResolvedValueOnce(withoutPro())
    vi.mocked(api.grantAdminVip).mockResolvedValueOnce({
      ...withoutPro({ source: 'courtesy', courtesyUntilUtc: '2099-12-31T00:00:00Z', canRevokeVip: true }),
      hasProAccess: true,
    })
    renderAdmin('/admin/usuarios/u-2')
    await screen.findByText(copy.users.accessNone)

    // Por defecto es un mes: lo permanente se elige a propósito.
    expect(screen.getByRole('button', { name: '30 días' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: copy.users.vipForever }))
    await userEvent.click(screen.getByRole('button', { name: copy.users.grantVip }))
    await userEvent.click(screen.getByRole('button', { name: copy.users.confirm }))

    expect(api.grantAdminVip).toHaveBeenCalledWith('token', 'u-2', null)
    expect(await screen.findByText(copy.users.accessCourtesyForever)).toBeInTheDocument()
  })

  it('devuelve la semana gratis', async () => {
    vi.mocked(api.grantAdminTrial).mockResolvedValueOnce({
      ...detail,
      hasUsedTrial: false,
      access: { ...baseAccess, trialState: 'granted', trialGrantedAtUtc: '2026-09-11T12:00:00Z', canGrantTrial: false },
    })
    renderAdmin('/admin/usuarios/u-2')

    expect(await screen.findByText(copy.users.trialUsed)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: copy.users.grantTrial }))
    expect(screen.getByText(copy.users.grantTrialConfirm)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: copy.users.confirm }))

    expect(api.grantAdminTrial).toHaveBeenCalledWith('token', 'u-2')
    expect(await screen.findByText(/^Habilitada por un admin el /)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.users.grantTrial })).not.toBeInTheDocument()
  })

  it('volver cierra la confirmación sin tocar nada', async () => {
    renderAdmin('/admin/usuarios/u-2')
    await screen.findByText(copy.users.accessSubscription)

    await userEvent.click(screen.getByRole('button', { name: copy.users.revokeVip }))
    await userEvent.click(screen.getByRole('button', { name: copy.users.back }))

    expect(api.revokeAdminVip).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: copy.users.revokeVip })).toBeInTheDocument()
  })

  it('si la acción falla, lo dice y la ficha queda como estaba', async () => {
    vi.mocked(api.revokeAdminVip).mockRejectedValueOnce(new Error('Mercado Pago no canceló la suscripción.'))
    renderAdmin('/admin/usuarios/u-2')
    await screen.findByText(copy.users.accessSubscription)

    await userEvent.click(screen.getByRole('button', { name: copy.users.revokeVip }))
    await userEvent.click(screen.getByRole('button', { name: copy.users.confirm }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Mercado Pago no canceló la suscripción.')
    expect(screen.getByText(copy.users.accessSubscription)).toBeInTheDocument()
  })

  it('a un admin sólo le dice que siempre tiene Pro', async () => {
    vi.mocked(api.getAdminUser).mockResolvedValueOnce({
      ...detail,
      isAdmin: true,
      access: { ...baseAccess, source: 'admin', canGrantVip: false, grantVipBlockedReason: 'admin', canRevokeVip: false, canGrantTrial: false },
    })
    renderAdmin('/admin/usuarios/u-2')

    expect(await screen.findByText(copy.users.accessAdmin)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.users.grantVip })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.users.revokeVip })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.users.grantTrial })).not.toBeInTheDocument()
  })

  it('el Pro de regalo encima de una suscripción se ve aparte', async () => {
    vi.mocked(api.getAdminUser).mockResolvedValueOnce({
      ...detail,
      access: { ...baseAccess, courtesyUntilUtc: '2026-12-10T12:00:00Z' },
    })
    renderAdmin('/admin/usuarios/u-2')

    expect(await screen.findByText(copy.users.accessSubscription)).toBeInTheDocument()
    expect(screen.getByText(/^Tiene Pro de regalo hasta el /)).toBeInTheDocument()
  })
})

describe('AdminApp · Cobros', () => {
  it('lista los cobros, filtra por estado y lleva a la cuenta', async () => {
    renderAdmin('/admin/cobros')

    expect(await screen.findByText('lucia@example.com')).toBeInTheDocument()
    expect(api.getAdminInvoices).toHaveBeenCalledWith('token', null, 1)

    await userEvent.click(screen.getByRole('button', { name: `${copy.invoices.statuses.rechazado} · 1` }))
    await waitFor(() => expect(api.getAdminInvoices).toHaveBeenLastCalledWith('token', 'rechazado', 1))

    await userEvent.click(screen.getByRole('button', { name: 'martin@example.com' }))

    expect(window.location.pathname).toBe('/admin/usuarios/u-2')
  })

  it('exporta los cobros', async () => {
    vi.mocked(api.getAdminExport).mockResolvedValueOnce(new Blob(['id']))
    renderAdmin('/admin/cobros')
    await screen.findByText('lucia@example.com')

    await userEvent.click(screen.getByRole('button', { name: copy.exportCsv }))

    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^vistazo-cobros-/)))
    expect(api.getAdminExport).toHaveBeenCalledWith('token', 'invoices')
  })
})

describe('AdminApp · IA', () => {
  it('muestra tokens, modelo, métricas y errores, y avisa que falta el precio', async () => {
    renderAdmin('/admin/ia')

    expect(await screen.findByText('gemini-3.1-flash-lite')).toBeInTheDocument()
    expect(screen.getByText('tonopicante')).toBeInTheDocument()
    expect(screen.getByText(copy.urgencies.aiErrors.blocked)).toBeInTheDocument()
    expect(screen.getByText(copy.aiPrices.missing)).toBeInTheDocument()
    expect(screen.queryByText(copy.ai.notTracked)).not.toBeInTheDocument()
    expect(api.getAdminAi).toHaveBeenCalledWith('token', 30)
  })

  it('sin llamadas registradas lo dice en vez de dibujar ceros', async () => {
    vi.mocked(api.getAdminAi).mockResolvedValueOnce({
      ...ai,
      tracked: false,
      inputTokens: 0,
      outputTokens: 0,
      tokensByDay: Array.from({ length: 30 }, () => 0),
      byMetric: [],
      errorsByCode: [],
    })
    renderAdmin('/admin/ia')

    expect(await screen.findByText(copy.ai.notTracked)).toBeInTheDocument()
    expect(screen.getByText(copy.ai.tokensEmpty)).toBeInTheDocument()
    expect(screen.getByText(copy.ai.byMetricEmpty)).toBeInTheDocument()
    expect(screen.getByText(copy.ai.errorsEmpty)).toBeInTheDocument()
  })
})

describe('AdminApp · Producto', () => {
  it('muestra los análisis, los rankings y las historias', async () => {
    renderAdmin('/admin/producto')

    expect(await screen.findByText('ghosting')).toBeInTheDocument()
    expect(screen.getByText('redflags')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('120 vistas en total')).toBeInTheDocument()
    expect(api.getAdminProduct).toHaveBeenCalledWith('token', 30)
  })
})

describe('AdminApp · Sistema', () => {
  it('marca cada integración, cuenta los trials negados y lista las acciones del panel', async () => {
    renderAdmin('/admin/sistema')

    expect(await screen.findByText('TESTUSER4000')).toBeInTheDocument()
    expect(screen.getByText(copy.system.hints['mercadopago:warn'])).toBeInTheDocument()
    expect(screen.getByText(copy.system.hints['ai_prices:off'])).toBeInTheDocument()
    expect(screen.getByText('abc1234')).toBeInTheDocument()
    expect(screen.getByText(copy.urgencies.trialReasons.device_used)).toBeInTheDocument()
    expect(screen.getByText(copy.system.actions.export_users)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: copy.system.openTarget }))

    expect(window.location.pathname).toBe('/admin/usuarios/u-2')
  })
})
