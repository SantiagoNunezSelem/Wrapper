import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import { SubscriptionPage } from '../SubscriptionPage'
import type {
  SubscriptionActions,
  SubscriptionOverview,
  SubscriptionRecord,
  UserProfile,
} from '../../types'

const copy = shellCopy.es.subscriptionPage

const user: UserProfile = {
  id: 'u1',
  email: 'santi@example.com',
  displayName: 'Santi',
  avatarUrl: null,
  isAdmin: false,
  hasUsedTrial: false,
  hasVipAccess: false,
  subscriptionState: 'inactiva',
  hasAiConsent: false,
  aiEnabled: true,
  paymentsEnabled: true,
  preferredLanguage: 'es',
}

const noActions: SubscriptionActions = {
  canSubscribe: false,
  canResumeCheckout: false,
  canCancel: false,
  canPause: false,
  canResume: false,
}

function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: 's1',
    status: 'activa',
    planType: 'mensual',
    amount: 7800,
    currencyId: 'ARS',
    paymentProvider: 'mercadopago',
    paymentMethodLabel: 'visa ···· 6411',
    externalSubscriptionId: 'pre-1',
    trialStartsAtUtc: null,
    trialEndsAtUtc: null,
    subscriptionStartsAtUtc: '2026-07-01T00:00:00Z',
    nextBillingAtUtc: '2026-09-01T00:00:00Z',
    lastPaymentAtUtc: '2026-08-01T00:00:00Z',
    cancelledAtUtc: null,
    graceEndsAtUtc: null,
    pausedAtUtc: null,
    lastSyncedAtUtc: '2026-08-26T10:00:00Z',
    trialWasApplied: false,
    isDevSimulated: false,
    hasAccess: true,
    autoRenewEnabled: true,
    accessUntilUtc: '2026-09-01T00:00:00Z',
    checkoutUrl: null,
    pendingReason: null,
    createdAtUtc: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function overview(
  current: SubscriptionRecord | null,
  actions: Partial<SubscriptionActions> = {},
): SubscriptionOverview {
  return {
    plan: {
      amount: 7800,
      currencyId: 'ARS',
      frequency: 1,
      frequencyType: 'months',
      trialFrequency: 7,
      trialFrequencyType: 'days',
      name: 'Vistazo Pro',
      providerConfigured: true,
    },
    current,
    hasVipAccess: current?.hasAccess ?? false,
    isAdmin: false,
    accessFromAdminOverride: false,
    trialAvailable: false,
    trialDeniedReason: null,
    actions: { ...noActions, ...actions },
    manageUrl: 'https://www.mercadopago.com.ar/subscriptions',
    history: current ? [current] : [],
    invoices: [],
    events: [],
    warning: null,
    cancellation: null,
  }
}

function renderPage(data: SubscriptionOverview | null, props: Record<string, unknown> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onLanguageToggle: vi.fn(),
    onCancel: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onRefresh: vi.fn(),
    onSignIn: vi.fn(),
  }

  render(
    <SubscriptionPage
      language="es"
      copy={copy}
      user={user}
      token="token"
      overview={data}
      busyAction={null}
      error=""
      {...handlers}
      {...props}
    />,
  )

  return handlers
}

describe('SubscriptionPage', () => {
  describe('pago pendiente', () => {
    it('explica POR QUÉ está pendiente en vez de repetir la palabra', () => {
      renderPage(
        overview(
          record({ status: 'pendiente', hasAccess: false, autoRenewEnabled: false, pendingReason: 'pending_contingency' }),
        ),
      )

      expect(screen.getByText(copy.pendingReasons.pending_contingency, { exact: false })).toBeInTheDocument()
    })

    it('un status_detail que no conocemos cae en el texto genérico, nunca en el código crudo', () => {
      renderPage(
        overview(record({ status: 'pendiente', hasAccess: false, pendingReason: 'algo_que_mercado_pago_agregue' })),
      )

      expect(screen.getByText(copy.pendingReasonFallback, { exact: false })).toBeInTheDocument()
      expect(screen.queryByText(/algo_que_mercado_pago_agregue/)).not.toBeInTheDocument()
    })

    it('ofrece terminar el pago que quedó a medias, apuntando al checkout guardado', () => {
      renderPage(
        overview(
          record({ status: 'pendiente', hasAccess: false, checkoutUrl: 'https://mp.test/subscribe/pre-1' }),
          { canResumeCheckout: true },
        ),
      )

      expect(screen.getByRole('link', { name: copy.resumeCheckoutCta })).toHaveAttribute(
        'href',
        'https://mp.test/subscribe/pre-1',
      )
    })

    it('sin checkout para retomar no inventa un link muerto', () => {
      renderPage(overview(record({ status: 'pendiente', hasAccess: false, checkoutUrl: null })))

      expect(screen.queryByRole('link', { name: copy.resumeCheckoutCta })).not.toBeInTheDocument()
      // Pero sí sigue diciendo que lo estamos mirando solos, que es la parte que evita
      // que alguien que ya pagó crea que se perdió la plata.
      expect(screen.getByText(copy.alreadyPaidNote)).toBeInTheDocument()
    })
  })

  describe('cancelar', () => {
    it('durante la prueba promete que NO se cobra nada', async () => {
      renderPage(
        overview(
          record({
            status: 'trial',
            trialEndsAtUtc: '2026-09-02T00:00:00Z',
            nextBillingAtUtc: '2026-09-02T00:00:00Z',
            lastPaymentAtUtc: null,
            trialWasApplied: true,
          }),
          { canCancel: true },
        ),
      )

      await userEvent.click(screen.getByRole('button', { name: copy.cancelCta }))

      // El texto de la prueba, no el genérico: cancelar antes del primer débito significa
      // que el cobro ni se intenta.
      expect(screen.getByText(/no se va a hacer/i)).toBeInTheDocument()
    })

    it('con un mes ya pagado promete el acceso hasta la fecha, no la ausencia de cobro', async () => {
      renderPage(overview(record(), { canCancel: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.cancelCta }))

      expect(screen.getByText(/Mantenés el acceso Pro hasta/i)).toBeInTheDocument()
    })

    it('confirmar dispara onCancel una sola vez', async () => {
      const handlers = renderPage(overview(record(), { canCancel: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.cancelCta }))
      await userEvent.click(screen.getByRole('button', { name: copy.cancelConfirmYes }))

      expect(handlers.onCancel).toHaveBeenCalledTimes(1)
    })

    it('se puede salir con Escape sin cancelar nada', async () => {
      const handlers = renderPage(overview(record(), { canCancel: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.cancelCta }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await userEvent.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(handlers.onCancel).not.toHaveBeenCalled()
    })

    it('el aviso de qué pasó se muestra con lo que respondió el servidor', () => {
      const data = overview(record({ status: 'cancelada', autoRenewEnabled: false }))
      data.cancellation = { nothingWillBeCharged: true, alreadyCancelled: false, accessUntilUtc: null }

      renderPage(data)

      expect(screen.getByText(copy.cancelledNothingCharged)).toBeInTheDocument()
    })
  })

  describe('acciones', () => {
    it('sólo muestra los botones que el servidor habilita', () => {
      renderPage(overview(record({ status: 'pausada', autoRenewEnabled: false }), { canResume: true }))

      expect(screen.getByRole('button', { name: copy.resumeCta })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: copy.pauseCta })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: copy.cancelCta })).not.toBeInTheDocument()
    })

    it('pausar pide confirmación antes de tocar nada', async () => {
      const handlers = renderPage(overview(record(), { canPause: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.pauseCta }))
      expect(handlers.onPause).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: copy.pauseConfirmYes }))
      expect(handlers.onPause).toHaveBeenCalledTimes(1)
    })

    it('el link para cambiar la tarjeta abre Mercado Pago, que es donde se cambia', () => {
      renderPage(overview(record()))

      const link = screen.getByRole('link', { name: copy.changeCardCta })
      expect(link).toHaveAttribute('href', 'https://www.mercadopago.com.ar/subscriptions')
      expect(link).toHaveAttribute('target', '_blank')
    })
  })

  describe('estado de la renovación', () => {
    it('una suscripción cancelada dice hasta cuándo llega el acceso, no cuándo renueva', () => {
      renderPage(overview(record({ status: 'cancelada', autoRenewEnabled: false })))

      expect(screen.getByText(copy.endsOn)).toBeInTheDocument()
      expect(screen.queryByText(copy.renewsOn)).not.toBeInTheDocument()
      expect(screen.getByText(copy.autoRenewOff)).toBeInTheDocument()
    })

    it('una activa dice cuándo es el próximo cobro', () => {
      renderPage(overview(record()))

      expect(screen.getByText(copy.renewsOn)).toBeInTheDocument()
      expect(screen.getByText(copy.autoRenewOn)).toBeInTheDocument()
    })
  })
})
