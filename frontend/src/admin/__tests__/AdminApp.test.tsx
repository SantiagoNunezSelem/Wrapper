import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminCopy } from '../../copy/adminCopy'
import type { UserProfile } from '../../types'
import type { AdminBusiness, AdminUrgencies, AdminUserDetail, AdminUserPage } from '../types'

vi.mock('../adminApi', () => ({
  getAdminBusiness: vi.fn(),
  getAdminUrgencies: vi.fn(),
  searchAdminUsers: vi.fn(),
  getAdminUser: vi.fn(),
  syncAdminUser: vi.fn(),
}))

import * as api from '../adminApi'
import { AdminApp } from '../AdminApp'

const copy = adminCopy.es

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
  collectedByMonth: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((month, index) => ({ month, amount: (index + 1) * 70000 })),
  latestSubscriptions: [{ userId: 'u-1', email: 'lucia@example.com', status: 'activa', amount: 7800, currencyId: 'ARS', createdAtUtc: '2026-09-10T12:00:00Z' }],
}

const urgencies: AdminUrgencies = {
  items: [
    { kind: 'orphan_payment', severity: 'critical', atUtc: '2026-09-10T11:00:00Z', count: 1, userId: null, userEmail: null, reference: '7f3c', detail: 'subscription_preapproval', deadlineUtc: null },
    { kind: 'payment_failed', severity: 'warning', atUtc: '2026-09-09T12:00:00Z', count: 1, userId: 'u-2', userEmail: 'martin@example.com', reference: 'pre-2', detail: 'cc_rejected_insufficient_amount', deadlineUtc: '2026-09-12T12:00:00Z' },
    { kind: 'trial_blocked', severity: 'info', atUtc: '2026-09-10T10:00:00Z', count: 5, userId: null, userEmail: null, reference: null, detail: 'device_used', deadlineUtc: null },
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
  },
}

const page: AdminUserPage = {
  total: 1,
  page: 1,
  pageSize: 20,
  items: [{ id: 'u-2', email: 'martin@example.com', displayName: 'Martín Rodríguez', createdAtUtc: '2026-06-02T12:00:00Z', state: 'pago_fallido', isAdmin: false }],
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
  },
  subscriptions: [],
  invoices: [{ id: 'i-1', status: 'rechazado', statusDetail: 'cc_rejected_insufficient_amount', amount: 7800, currencyId: 'ARS', paidAtUtc: null, debitScheduledAtUtc: '2026-09-09T12:00:00Z', createdAtUtc: '2026-09-09T12:00:00Z', attemptNumber: 1 }],
  events: [{ id: 'e-1', topic: 'subscription_authorized_payment', action: 'created', resultingStatus: 'pago_fallido', notes: 'rejected/cc_rejected_insufficient_amount · activa → pago_fallido', createdAtUtc: '2026-09-09T12:02:00Z' }],
  usage: { savedAnalyses: 6, sharedStories: 2, aiMetrics: 11, aiMetricsFailed: 1, freeUnlocks: 3, trialClaims: 1, trialCountries: ['AR'] },
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
})

afterEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('AdminApp · acceso', () => {
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
})

describe('AdminApp · Negocio', () => {
  it('muestra las cifras y dice qué todavía no se puede medir', async () => {
    renderAdmin('/admin')

    expect(await screen.findByText('1.284')).toBeInTheDocument()
    expect(screen.getByText('57')).toBeInTheDocument()
    // Según la versión de ICU, Intl pega el signo al número o lo separa con un espacio duro.
    expect(screen.getByText(/^38\s?%$/)).toBeInTheDocument()
    expect(screen.getByText(copy.business.activeUsers)).toBeInTheDocument()
    expect(screen.getAllByText(copy.business.noData)).toHaveLength(2)
    expect(api.getAdminBusiness).toHaveBeenCalledWith('token', 30)
  })

  it('cambiar el período vuelve a pedir con esa ventana', async () => {
    renderAdmin('/admin')
    await screen.findByText('1.284')

    await userEvent.click(screen.getByRole('button', { name: copy.business.periods[7] }))

    await waitFor(() => expect(api.getAdminBusiness).toHaveBeenLastCalledWith('token', 7))
  })

  it('una columna enfocada muestra su valor', async () => {
    renderAdmin('/admin')
    await screen.findByText('1.284')

    const column = screen.getByLabelText(copy.business.signupsTip.replace('{n}', '1').replace('{when}', copy.business.daysAgo.replace('{n}', '28')))
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

    await userEvent.click(screen.getByRole('button', { name: `${copy.urgencies.severity.warning} · 1` }))

    expect(screen.queryByText(copy.urgencies.kinds.orphan_payment)).not.toBeInTheDocument()
    expect(screen.getByText(copy.urgencies.kinds.payment_failed)).toBeInTheDocument()
  })

  it('"Ver ficha" lleva a la cuenta', async () => {
    renderAdmin('/admin/urgencias')

    await userEvent.click(await screen.findByRole('button', { name: copy.urgencies.openUser }))

    expect(window.location.pathname).toBe('/admin/usuarios/u-2')
    expect(await screen.findByRole('heading', { name: 'Martín Rodríguez' })).toBeInTheDocument()
    expect(api.getAdminUser).toHaveBeenCalledWith('token', 'u-2')
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

  it('el menú lateral cambia de sección y deja la URL', async () => {
    renderAdmin('/admin/usuarios')
    await screen.findByText(copy.users.pick)

    await userEvent.click(screen.getByRole('button', { name: copy.nav.negocio }))

    expect(window.location.pathname).toBe('/admin')
    expect(await screen.findByText('1.284')).toBeInTheDocument()
  })
})
