import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import { startCheckout } from '../../lib/api'
import { SubscriptionPage } from '../SubscriptionPage'
import { TooltipProvider } from '../TooltipProvider'
import type {
  SubscriptionActions,
  SubscriptionOverview,
  SubscriptionRecord,
  UserProfile,
} from '../../types'

// Only the checkout call is replaced: the tests below check which address it is opened
// for, and a real request (or a real redirect) has no place in a component test.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  startCheckout: vi.fn(),
}))

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
  checkoutTestPayerEmail: null,
  preferredLanguage: 'es',
}

const noActions: SubscriptionActions = {
  canSubscribe: false,
  canResumeCheckout: false,
  canCancel: false,
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
    payerEmail: null,
    pendingReason: null,
    paymentInProgress: false,
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
    onResume: vi.fn(),
    onRefresh: vi.fn(),
    onSignIn: vi.fn(),
  }

  render(
    <TooltipProvider>
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
      />
    </TooltipProvider>,
  )

  return handlers
}

describe('SubscriptionPage', () => {
  describe('encabezado', () => {
    it('muestra la inicial en el mismo círculo que el resto de la app, no el nombre escrito', () => {
      renderPage(overview(record()))

      expect(screen.getByRole('img', { name: user.displayName })).toHaveTextContent(/^S$/)
    })
  })

  describe('Pro de regalo', () => {
    it('dice hasta cuándo y que no se cobra nada', () => {
      renderPage({ ...overview(null), hasVipAccess: true, courtesyUntilUtc: '2026-12-10T12:00:00Z' })

      expect(screen.getByText(/^Tenés Pro de regalo hasta el .+\. No se te cobra nada\.$/)).toBeInTheDocument()
    })

    it('sin vencimiento no inventa una fecha', () => {
      renderPage({ ...overview(null), hasVipAccess: true, courtesyUntilUtc: '2099-12-31T00:00:00Z' })

      expect(screen.getByText(copy.courtesyNoteForever)).toBeInTheDocument()
    })
  })

  describe('actividad de la cuenta', () => {
    // Tópicos de webhook y transiciones de estado: un diagnóstico para quien administra la
    // facturación, no algo que un cliente pueda leer.
    const event = {
      id: 'e1',
      topic: 'subscription_preapproval',
      action: 'updated',
      resultingStatus: 'activa',
      notes: 'activa → activa',
      createdAtUtc: '2026-09-10T03:16:00Z',
    }

    it('no se le muestra a un usuario común', () => {
      renderPage({ ...overview(record()), events: [event] })

      expect(screen.queryByText(copy.eventsTitle)).not.toBeInTheDocument()
    })

    it('sí se le muestra a un admin', () => {
      renderPage({ ...overview(record()), isAdmin: true, events: [event] })

      expect(screen.getByText(copy.eventsTitle)).toBeInTheDocument()
    })
  })

  describe('pago en proceso', () => {
    it('explica POR QUÉ está pendiente en vez de repetir la palabra', () => {
      renderPage(
        overview(
          record({
            status: 'pendiente',
            hasAccess: false,
            autoRenewEnabled: false,
            paymentInProgress: true,
            pendingReason: 'pending_contingency',
          }),
        ),
      )

      expect(screen.getByText(copy.pendingReasons.pending_contingency, { exact: false })).toBeInTheDocument()
    })

    it('un status_detail que no conocemos cae en el texto genérico, nunca en el código crudo', () => {
      renderPage(
        overview(
          record({
            status: 'pendiente',
            hasAccess: false,
            paymentInProgress: true,
            pendingReason: 'algo_que_mercado_pago_agregue',
          }),
        ),
      )

      expect(screen.getByText(copy.pendingReasonFallback, { exact: false })).toBeInTheDocument()
      expect(screen.queryByText(/algo_que_mercado_pago_agregue/)).not.toBeInTheDocument()
    })

    it('sin checkout para retomar no inventa un link muerto', () => {
      renderPage(
        overview(record({ status: 'pendiente', hasAccess: false, paymentInProgress: true, checkoutUrl: null })),
      )

      expect(screen.queryByRole('link', { name: copy.resumeCheckoutCta })).not.toBeInTheDocument()
      // Pero sí sigue diciendo que lo estamos mirando solos, que es la parte que evita
      // que alguien que ya pagó crea que se perdió la plata.
      expect(screen.getByText(copy.alreadyPaidNote)).toBeInTheDocument()
    })
  })

  /**
   * El caso que motivó la separación: alguien abre el checkout, se arrepiente y cierra la
   * pestaña. Por dentro queda igual de `pendiente` que un cobro en curso, pero no se
   * intentó cobrar nada — y decirle "Pendiente de pago" lo hace pensar que tiene plata
   * dando vueltas.
   */
  describe('checkout que se abrió y no se terminó', () => {
    const abandoned = () =>
      record({
        status: 'pendiente',
        hasAccess: false,
        autoRenewEnabled: false,
        paymentInProgress: false,
        pendingReason: null,
        checkoutUrl: 'https://mp.test/subscribe/pre-1',
      })

    it('no lo llama pago pendiente ni lo pinta como algo que atender', () => {
      renderPage(overview(abandoned(), { canResumeCheckout: true }))

      // Dos veces: el panel de arriba y la fila del historial. Las dos tienen que contar
      // la misma historia, o el historial desmiente al panel.
      expect(screen.getAllByText(copy.checkoutOpenStatus)).toHaveLength(2)
      expect(screen.queryByText(copy.statuses.pendiente)).not.toBeInTheDocument()
      expect(screen.queryByText(copy.statusHints.pendiente)).not.toBeInTheDocument()
    })

    it('dice explícitamente que no se cobró nada', () => {
      renderPage(overview(abandoned(), { canResumeCheckout: true }))

      expect(screen.getByText(copy.checkoutOpenHint)).toBeInTheDocument()
      expect(screen.getByText(copy.checkoutOpenPaidNote)).toBeInTheDocument()
      expect(screen.queryByText(copy.alreadyPaidNote)).not.toBeInTheDocument()
    })

    it('con la tarjeta rechazada dice el motivo sin llamarlo pago en curso', () => {
      // El intento terminó: no hay nada procesándose, pero sí algo que contar. Tampoco es
      // un checkout abandonado: el pagador llegó hasta el final y la tarjeta lo rebotó,
      // así que decirle que no llegó a completarlo sería falso.
      renderPage(
        overview(
          record({
            status: 'pendiente',
            hasAccess: false,
            paymentInProgress: false,
            pendingReason: 'cc_rejected_insufficient_amount',
            checkoutUrl: 'https://mp.test/subscribe/pre-1',
          }),
          { canResumeCheckout: true },
        ),
      )

      expect(screen.getByText(copy.checkoutRejectedHint)).toBeInTheDocument()
      expect(screen.queryByText(copy.checkoutOpenHint)).not.toBeInTheDocument()
      expect(
        screen.getByText(copy.pendingReasons.cc_rejected_insufficient_amount, { exact: false }),
      ).toBeInTheDocument()
    })

    it('igual ofrece retomarlo donde quedó', () => {
      renderPage(overview(abandoned(), { canResumeCheckout: true }))

      expect(screen.getByRole('link', { name: copy.resumeCheckoutCta })).toHaveAttribute(
        'href',
        'https://mp.test/subscribe/pre-1',
      )
    })

    it('no dibuja la tarjeta del plan: todavía no hay plan', () => {
      // Mercado Pago proyecta un día de inicio y un primer cobro apenas se abre el
      // checkout. Mostrarlos arriba de "Tu plan" describe una suscripción andando, que es
      // justo lo contrario de lo que dice el cartel de al lado.
      renderPage(
        overview(
          record({
            ...abandoned(),
            subscriptionStartsAtUtc: '2026-09-11T00:00:00Z',
            nextBillingAtUtc: '2026-09-18T00:00:00Z',
          }),
          { canResumeCheckout: true },
        ),
      )

      expect(screen.queryByText(copy.currentPlanTitle)).not.toBeInTheDocument()
      expect(screen.queryByText(copy.startedOn)).not.toBeInTheDocument()
    })

    it('deja descartar el intento desde el mismo cartel', async () => {
      // La acción vivía en la tarjeta del plan, que ya no se dibuja acá. Sin esto, un
      // checkout trabado no tendría salida.
      const handlers = renderPage(overview(abandoned(), { canCancel: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.discardCheckoutCta }))
      await userEvent.click(screen.getByRole('button', { name: copy.discardCheckoutYes }))

      expect(handlers.onCancel).toHaveBeenCalledTimes(1)
    })
  })

  // Mercado Pago solo deja pagar a la cuenta cuyo mail es el del checkout, y cuando no
  // coincide rebota en su propia página, sin salida y sin avisarnos. Por eso el mail se
  // muestra (y se puede cambiar) antes de salir, y otra vez si la persona vuelve sin pagar.
  describe('mail de Mercado Pago', () => {
    const checkout = vi.mocked(startCheckout)

    beforeEach(() => {
      checkout.mockReset()
      checkout.mockResolvedValue({ initPoint: '#mercado-pago', subscriptionId: 's2', resumed: false })
    })

    const unfinished = (overrides: Partial<SubscriptionRecord> = {}) =>
      record({
        status: 'pendiente',
        hasAccess: false,
        autoRenewEnabled: false,
        paymentInProgress: false,
        checkoutUrl: 'https://mp.test/subscribe/pre-1',
        payerEmail: 'santi@example.com',
        ...overrides,
      })

    it('la tarjeta del plan dice con qué cuenta se va a pagar, y el botón la usa tal cual', async () => {
      renderPage(overview(null, { canSubscribe: true }))

      expect(screen.getByText(copy.payerEmailLabel)).toBeInTheDocument()
      expect(screen.getByText('santi@example.com')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: copy.buyCta }))

      expect(checkout).toHaveBeenCalledWith('token', 'santi@example.com')
    })

    it('"Cambiar" deja abrir el pago a nombre de otra cuenta', async () => {
      renderPage(overview(null, { canSubscribe: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.payerEmailChange }))
      const field = screen.getByLabelText(copy.payerEmailInputLabel)
      await userEvent.clear(field)
      await userEvent.type(field, 'otra.cuenta@hotmail.com')
      await userEvent.click(screen.getByRole('button', { name: copy.buyCta }))

      expect(checkout).toHaveBeenCalledWith('token', 'otra.cuenta@hotmail.com')
    })

    it('un mail que no es un mail no sale de la pantalla', async () => {
      renderPage(overview(null, { canSubscribe: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.payerEmailChange }))
      const field = screen.getByLabelText(copy.payerEmailInputLabel)
      await userEvent.clear(field)
      await userEvent.type(field, 'otra.cuenta')
      await userEvent.click(screen.getByRole('button', { name: copy.buyCta }))

      expect(checkout).not.toHaveBeenCalled()
      expect(screen.getByText(copy.payerEmailInvalid)).toBeInTheDocument()
    })

    it('si ya hubo un intento, ofrece el mail de ese intento y no el de Google', () => {
      renderPage(overview(unfinished({ payerEmail: 'otra@hotmail.com' }), { canSubscribe: true }))

      expect(screen.getAllByText('otra@hotmail.com', { exact: false }).length).toBeGreaterThan(0)
      expect(screen.queryByText('santi@example.com')).not.toBeInTheDocument()
    })

    it('con el comprador de prueba forzado no hay nada que cambiar', () => {
      renderPage(overview(null, { canSubscribe: true }), {
        user: { ...user, checkoutTestPayerEmail: 'test_user_1@testuser.com' },
      })

      expect(screen.getByText('test_user_1@testuser.com')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: copy.payerEmailChange })).not.toBeInTheDocument()
    })

    it('al volver sin pagar, muestra con qué cuenta y UN solo botón', () => {
      // Nada compitiendo con "Terminar el pago": ni un "Actualizar estado" (eso pasa solo),
      // ni la tarjeta del plan con su propio "Empezar" (haría lo mismo con otro nombre).
      renderPage(overview(unfinished(), { canResumeCheckout: true, canSubscribe: true, canCancel: true }))

      expect(screen.getByText('santi@example.com')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: copy.resumeCheckoutCta })).toHaveAttribute(
        'href',
        'https://mp.test/subscribe/pre-1',
      )
      expect(screen.queryByRole('button', { name: /actualizar estado/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: copy.buyCta })).not.toBeInTheDocument()
      expect(screen.queryByText(copy.planName)).not.toBeInTheDocument()
    })

    it('"Cambiar" en el pago sin terminar lo abre a nombre de otra cuenta', async () => {
      renderPage(overview(unfinished(), { canResumeCheckout: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.payerEmailChange }))
      const field = screen.getByLabelText(copy.payerEmailInputLabel)
      await userEvent.clear(field)
      await userEvent.type(field, 'otra@hotmail.com')
      await userEvent.click(screen.getByRole('button', { name: copy.payerEmailContinue }))

      expect(checkout).toHaveBeenCalledWith('token', 'otra@hotmail.com')
    })

    it('con el mismo mail sigue siendo el link de siempre, sin abrir otro checkout', async () => {
      renderPage(overview(unfinished(), { canResumeCheckout: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.payerEmailChange }))

      expect(screen.getByRole('link', { name: copy.resumeCheckoutCta })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: copy.payerEmailContinue })).not.toBeInTheDocument()
    })

    it('"Cancelar" vuelve a la línea con el mail original', async () => {
      renderPage(overview(unfinished(), { canResumeCheckout: true }))

      await userEvent.click(screen.getByRole('button', { name: copy.payerEmailChange }))
      await userEvent.type(screen.getByLabelText(copy.payerEmailInputLabel), 'xx')
      await userEvent.click(screen.getByRole('button', { name: copy.payerEmailCancel }))

      expect(screen.getByText('santi@example.com')).toBeInTheDocument()
      expect(screen.queryByLabelText(copy.payerEmailInputLabel)).not.toBeInTheDocument()
    })

    it('con un pago en curso deja volver al checkout, pero no cambiar de cuenta', () => {
      // `pending_challenge`: el banco pide que la persona confirme, y eso se hace en la
      // misma página de Mercado Pago. Abrirlo para otra cuenta dejaría ese cobro colgado.
      renderPage(
        overview(unfinished({ paymentInProgress: true, pendingReason: 'pending_challenge' }), {
          canResumeCheckout: true,
        }),
      )

      expect(screen.getByRole('link', { name: copy.resumeCheckoutCta })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: copy.payerEmailChange })).not.toBeInTheDocument()
    })

    it('descartar es un link dentro de la letra chica, no otro botón grande', () => {
      renderPage(overview(unfinished(), { canResumeCheckout: true, canCancel: true }))

      const discard = screen.getByRole('button', { name: copy.discardCheckoutCta })
      expect(discard).toHaveClass('subpage-text-link')
      expect(discard.closest('p')).toHaveTextContent(copy.discardCheckoutPrompt)
    })
  })

  describe('re-chequeo automático', () => {
    function returnToTab() {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    it('al volver a la pestaña con algo pendiente, le vuelve a preguntar a Mercado Pago', () => {
      const handlers = renderPage(
        overview(record({ status: 'pendiente', hasAccess: false, checkoutUrl: 'https://mp.test/x' }), {
          canResumeCheckout: true,
        }),
      )

      returnToTab()
      // Una vez por minuto como mucho: cada chequeo llega hasta Mercado Pago.
      returnToTab()

      expect(handlers.onRefresh).toHaveBeenCalledTimes(1)
    })

    it('sin nada pendiente no molesta a Mercado Pago', () => {
      const handlers = renderPage(overview(record()))

      returnToTab()

      expect(handlers.onRefresh).not.toHaveBeenCalled()
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
      expect(screen.queryByRole('button', { name: copy.cancelCta })).not.toBeInTheDocument()
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
