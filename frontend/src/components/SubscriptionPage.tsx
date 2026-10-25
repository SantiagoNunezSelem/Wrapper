import { useEffect, useRef, useState } from 'react'
import { ApiError, startCheckout } from '../lib/api'
import { goToCheckout, prefersCheckoutWindow } from '../lib/checkoutWindow'
import { formatMoney, formatPaymentMethod } from '../lib/format'
import { defaultPayerEmail, isPlausibleEmail } from '../lib/payerEmail'
import { checkoutErrorMessage, describePaymentReason, type PaymentReasonCopy } from '../lib/paymentReasons'
import { phaseOf } from '../lib/subscriptionPhase'
import { ConfirmDialog } from './ConfirmDialog'
import { PayerEmailPicker, PlanPurchaseFlow, type PlanPurchaseFlowCopy } from './PlanPurchaseFlow'
import type {
  Language,
  SubscriptionInvoice,
  SubscriptionOverview,
  SubscriptionPhase,
  SubscriptionRecord,
  UserProfile,
} from '../types'

/** Every action the account screen can be waiting on. */
export type SubscriptionBusyAction = 'cancel' | 'refresh' | 'resume'

export interface SubscriptionPageCopy extends PlanPurchaseFlowCopy, PaymentReasonCopy {
  reasonActionLabel: string
  eyebrow: string
  title: string
  lead: string
  backToApp: string
  signInPrompt: string
  signInCta: string
  close: string
  statuses: Record<string, string>
  statusHints: Record<string, string>
  statusNext: Record<string, string>
  pendingReasons: Record<string, string>
  pendingReasonFallback: string
  pendingReasonLabel: string
  checkoutOpenStatus: string
  checkoutOpenHint: string
  checkoutOpenNext: string
  checkoutOpenPaidNote: string
  checkoutRejectedStatus: string
  checkoutRejectedHint: string
  processingStatus: string
  processingHint: string
  processingNext: string
  confirmingStatus: string
  confirmingHint: string
  confirmingNext: string
  liveUpdating: string
  activatedNote: string
  trialActivatedNote: string
  cancelledHint: string
  cancelledNext: string
  endedStatus: string
  endedHint: string
  endedNext: string
  paymentFailedLockedHint: string
  pausedLockedHint: string
  resumeCheckoutCta: string
  payerEmailContinue: string
  payerEmailMismatchHint: string
  checkingStatus: string
  currentPlanTitle: string
  perMonth: string
  freeTrialBadge: string
  trialEndsOn: string
  renewsOn: string
  endsOn: string
  graceUntil: string
  paymentMethod: string
  /** Mercado Pago's payment_method_id → what the screen says ("account_money" → "Dinero en cuenta"). */
  paymentMethods: Record<string, string>
  startedOn: string
  lastPayment: string
  pausedSince: string
  accessUntilLabel: string
  lastCheckedLabel: string
  daysLeft: string
  oneDayLeft: string
  lastDay: string
  cancelCta: string
  cancelConfirmTitle: string
  cancelConfirmBody: string
  cancelConfirmTrialBody: string
  cancelConfirmPendingBody: string
  discardCheckoutPrompt: string
  discardCheckoutCta: string
  discardCheckoutTitle: string
  discardCheckoutYes: string
  cancelConfirmYes: string
  cancelConfirmNo: string
  cancelledNothingCharged: string
  cancelledKeepsAccess: string
  cancelledDone: string
  resumeCta: string
  resuming: string
  refreshing: string
  cancelling: string
  billedBy: string
  autoRenewOn: string
  autoRenewOff: string
  changeCardCta: string
  changeCardHint: string
  resubscribeTitle: string
  adminNote: string
  devNote: string
  courtesyNote: string
  courtesyNoteForever: string
  plansTitle: string
  planName: string
  invoicesTitle: string
  noInvoices: string
  invoiceStatuses: Record<string, string>
  invoicePeriod: string
  invoiceAttempt: string
  historyTitle: string
  noHistory: string
  eventsTitle: string
  eventsToggle: string
  noEvents: string
}

/**
 * The subscription/billing screen: its own route (`/suscripcion`), not a modal, because
 * it is the one part of the product that plays the role of a menu — plan, price,
 * cancellation, billing history — rather than the playful "Wrapped" experience. The
 * visual language is deliberately calmer than the rest of the app: solid panels, no
 * gradients on headings, no confetti.
 *
 * The screen is organised around one question — *what is going to happen to my money, and
 * when* — because that is what people actually come here to find out. So the state, what
 * it means, what happens next and the one button that changes it all live together at the
 * top, above the plan card; the facts, the billing history and the audit trail come after,
 * in that order of how often anyone needs them.
 *
 * Which buttons exist is decided by the server (`overview.actions`), not here. Otherwise
 * the rules drift between this screen and the mobile shell, and the UI ends up offering an
 * action the API answers with a 409.
 */
export function SubscriptionPage({
  language,
  copy,
  user,
  token,
  overview,
  busyAction,
  error,
  onBack,
  onLanguageToggle,
  onCancel,
  onResume,
  onRefresh,
  onSignIn,
  confirmingCheckout = false,
}: {
  language: Language
  copy: SubscriptionPageCopy
  user: UserProfile | null
  token: string | null
  overview: SubscriptionOverview | null
  busyAction: SubscriptionBusyAction | null
  error: string
  onBack: () => void
  onLanguageToggle: () => void
  onCancel: () => void
  onResume: () => void
  onRefresh: () => void
  onSignIn: () => void
  /** Just back from Mercado Pago, and the screen is still asking how it went. */
  confirmingCheckout?: boolean
}) {
  const isBusy = busyAction !== null
  const current = overview?.current ?? null
  const plan = overview?.plan ?? null
  const actions = overview?.actions ?? null
  const locale = language === 'es' ? 'es-AR' : 'en-US'
  const phase = current ? phaseOf(current) : null
  const hasResumableCheckout = current?.status === 'pendiente' && Boolean(actions?.canResumeCheckout)
  const isWaitingOnProvider = phase === 'processing' || phase === 'checkout_open'

  // Re-checks with Mercado Pago when the person comes back to this tab — the usual
  // moment after paying in another tab or the Mercado Pago app. Only while something is
  // pending, and at most every ten seconds, since each check reaches Mercado Pago.
  const refreshRef = useRef(onRefresh)
  useEffect(() => {
    refreshRef.current = onRefresh
  })
  const lastAutoRefresh = useRef(0)
  useEffect(() => {
    if (!isWaitingOnProvider) {
      return
    }

    function handleVisible() {
      if (document.visibilityState !== 'visible' || Date.now() - lastAutoRefresh.current < 10_000) {
        return
      }
      lastAutoRefresh.current = Date.now()
      refreshRef.current()
    }

    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [isWaitingOnProvider])

  // "¡Listo!" once, when the payment this screen was waiting on turns into Pro. Without
  // it the banner just changed colour under someone who was watching it, and a calm
  // "Activa" reads as nothing having happened.
  const [activatedAs, setActivatedAs] = useState<'trial' | 'activa' | null>(null)
  const previousPhase = useRef(phase)
  useEffect(() => {
    const before = previousPhase.current
    previousPhase.current = phase
    const wasWaiting = confirmingCheckout || before === 'processing' || before === 'checkout_open' || before === 'declined'
    if (wasWaiting && (phase === 'trial' || phase === 'activa')) {
      setActivatedAs(phase)
    }
  }, [phase, confirmingCheckout])

  return (
    <div className="subpage">
      <header className="subpage-header">
        <button type="button" className="subpage-back" onClick={onBack} aria-label={copy.backToApp}>
          <BackIcon />
          <span className="subpage-back-label">{copy.backToApp}</span>
        </button>

        <div className="subpage-header-actions">
          <button type="button" className="ghost-button" onClick={onLanguageToggle}>
            {language === 'es' ? 'EN' : 'ES'}
          </button>
          {user ? (
            <span className="subpage-account-avatar" role="img" aria-label={user.displayName} title={user.displayName}>
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
          ) : null}
        </div>
      </header>

      <main className="subpage-content">
        <div className="subpage-hero">
          <p className="subpage-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="subpage-lead">{copy.lead}</p>
        </div>

        {error ? <p className="subpage-error">{error}</p> : null}
        {overview?.warning ? <p className="subpage-error">{overview.warning}</p> : null}
        {activatedAs && (phase === 'trial' || phase === 'activa') ? (
          <p className="subpage-note subpage-note-success" role="status">
            {activatedAs === 'trial' ? copy.trialActivatedNote : copy.activatedNote}
          </p>
        ) : null}
        {overview?.cancellation ? <CancellationNote overview={overview} copy={copy} locale={locale} /> : null}
        {overview?.courtesyUntilUtc ? (
          <p className="subpage-note">
            {new Date(overview.courtesyUntilUtc).getUTCFullYear() >= 2099
              ? copy.courtesyNoteForever
              : fillTokens(copy.courtesyNote, { date: formatDate(overview.courtesyUntilUtc, locale) })}
          </p>
        ) : null}

        {!user ? (
          <section className="subpage-section subpage-signin">
            <p>{copy.signInPrompt}</p>
            <button type="button" className="primary-button" onClick={onSignIn}>
              {copy.signInCta}
            </button>
          </section>
        ) : null}

        {current && phase ? (
          <>
            {/* An attempt that went nowhere is no subscription at all: nothing to report,
                and the plan right below is the way forward. */}
            {phase !== 'abandoned' ? (
              <StatusBanner
                current={current}
                phase={phase}
                copy={copy}
                locale={locale}
                isBusy={isBusy}
                busyAction={busyAction}
                canResumeCheckout={Boolean(actions?.canResumeCheckout)}
                canCancel={Boolean(actions?.canCancel)}
                confirming={confirmingCheckout}
                token={token}
                payerEmailLocked={Boolean(user?.checkoutTestPayerEmail)}
                onCancel={onCancel}
              />
            ) : null}

            {/* Only for a plan that is running or still has access. Nothing has been
                bought on a pending or declined attempt, and a plan that already ended has
                nothing left to describe — its "Acceso hasta el" was a date in the past,
                read as one still ahead. The history keeps the record of both. */}
            {phase === 'trial' || phase === 'activa' || phase === 'pago_fallido' || phase === 'pausada' || phase === 'cancelled' ? (
              <CurrentPlanSection
                current={current}
                plan={plan}
                copy={copy}
                locale={locale}
                overview={overview}
                isBusy={isBusy}
                busyAction={busyAction}
                onCancel={onCancel}
                onResume={onResume}
              />
            ) : null}
          </>
        ) : null}

        {/* Not while a checkout is waiting to be finished: the banner's "Terminar el pago"
            is already the way to buy, and a second "Empezar" below it does the same thing
            under another name. */}
        {user && token && (actions?.canSubscribe ?? current === null) && !hasResumableCheckout ? (
          <PlansSection
            copy={copy}
            token={token}
            user={user}
            plan={plan}
            locale={locale}
            overview={overview}
            title={phase === 'ended' || phase === 'cancelled' ? copy.resubscribeTitle : copy.plansTitle}
          />
        ) : null}

        {user ? (
          <>
            <section className="subpage-section">
              <h2>{copy.invoicesTitle}</h2>
              {overview && overview.invoices.length > 0 ? (
                <ul className="subpage-list">
                  {overview.invoices.map((invoice) => (
                    <InvoiceRow key={invoice.id} invoice={invoice} copy={copy} locale={locale} />
                  ))}
                </ul>
              ) : (
                <p className="subpage-muted-copy">{copy.noInvoices}</p>
              )}
            </section>

            <section className="subpage-section">
              <h2>{copy.historyTitle}</h2>
              {overview && overview.history.length > 0 ? (
                <ul className="subpage-list">
                  {overview.history.map((item) => (
                    <HistoryRow key={item.id} record={item} copy={copy} locale={locale} />
                  ))}
                </ul>
              ) : (
                <p className="subpage-muted-copy">{copy.noHistory}</p>
              )}
            </section>

            {overview?.isAdmin ? <EventsSection overview={overview} copy={copy} locale={locale} /> : null}
          </>
        ) : null}
      </main>
    </div>
  )
}

/**
 * The one block that answers "what is happening with my payment". It is a separate,
 * louder panel rather than a line inside the plan card because in the states that matter —
 * a payment stuck on pending, a card that was declined — this is the only thing on the
 * page anybody is reading, and the action that resolves it has to be right underneath.
 */
function StatusBanner({
  current,
  phase,
  copy,
  locale,
  isBusy,
  busyAction,
  canResumeCheckout,
  canCancel,
  confirming,
  token,
  payerEmailLocked,
  onCancel,
}: {
  current: SubscriptionRecord
  phase: SubscriptionPhase
  copy: SubscriptionPageCopy
  locale: string
  isBusy: boolean
  busyAction: SubscriptionBusyAction | null
  canResumeCheckout: boolean
  canCancel: boolean
  /** Just back from Mercado Pago, still asking how it went. */
  confirming: boolean
  token: string | null
  /** `MercadoPago:TestPayerEmail` is set: the address is shown but cannot be changed. */
  payerEmailLocked: boolean
  onCancel: () => void
}) {
  // Closing an unfinished attempt lives here because the plan card it used to live in is
  // not drawn for one: there is no plan yet to cancel a renewal on.
  const [discarding, setDiscarding] = useState(false)
  const banner = describeBanner(current, phase, confirming, copy, locale)
  const isUnfinishedCheckout = phase === 'checkout_open'
  const reason = current.pendingReason
    ? describePaymentReason(copy, current.pendingReason, current.pendingReasonKind, {
        amount: formatMoney(current.amount, current.currencyId, locale),
        card: formatPaymentMethod(current.paymentMethodLabel, copy.paymentMethods),
      })
    : null
  // The screen is asking Mercado Pago on its own right now, so it says so: a banner that
  // promises "se actualiza sola" and then sits still reads as frozen.
  const isLive = phase === 'processing' || (confirming && isUnfinishedCheckout)

  return (
    <section className={`subpage-banner ${banner.attention ? 'is-attention' : 'is-calm'} banner-${banner.variant}`}>
      <div className="subpage-banner-head">
        <span className={`subpage-status status-${banner.variant}`}>{banner.label}</span>
        {current.hasAccess && current.accessUntilUtc ? (
          <span className="subpage-banner-countdown">{formatRemaining(current.accessUntilUtc, copy)}</span>
        ) : null}
      </div>

      {banner.hint ? <p className="subpage-banner-body">{banner.hint}</p> : null}
      {banner.next ? <p className="subpage-banner-next">{banner.next}</p> : null}

      {isLive ? (
        <p className="subpage-banner-fineprint subpage-live" aria-live="polite">
          <span className="subpage-live-dot" aria-hidden="true" />
          {busyAction === 'refresh' ? copy.checkingStatus : copy.liveUpdating}
        </p>
      ) : null}

      {/* Only ever shown with a real status_detail behind it: inventing a reason is worse
          than saying nothing, and the fallback already covers "no sabemos todavía". */}
      {reason ? (
        <div className="subpage-banner-reason">
          <p>
            <strong>{copy.pendingReasonLabel}:</strong> {reason.reason}
          </p>
          {reason.action ? (
            <p className="subpage-banner-reason-action">
              <strong>{copy.reasonActionLabel}:</strong> {reason.action}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* One button, nothing competing with it. Checking with Mercado Pago happens on its
          own (on the way back from the checkout, when the tab regains focus, and on the
          server's timer), so there is no "Actualizar estado" to press; and giving up on
          the attempt is a quiet link, not a second button of the same weight. */}
      {current.status === 'pendiente' ? (
        <>
          {canResumeCheckout && current.checkoutUrl ? (
            <ResumeCheckout
              copy={copy}
              token={token}
              checkoutUrl={current.checkoutUrl}
              // With a charge already moving (a bank asking the payer to confirm, say),
              // going back to the same page is still the way forward — but opening it
              // for another account would abandon money that may be on its way.
              openedFor={isUnfinishedCheckout ? current.payerEmail : null}
              payerEmailLocked={payerEmailLocked}
              disabled={isBusy}
            />
          ) : null}
          {/* The live line above already says it is being checked; this note is for when
              nobody is checking any more. */}
          {!isLive && isUnfinishedCheckout ? (
            <p className="subpage-banner-fineprint" aria-live="polite">
              {busyAction === 'refresh' ? copy.checkingStatus : copy.checkoutOpenPaidNote}
            </p>
          ) : null}
          {canCancel && !isLive ? (
            <p className="subpage-banner-fineprint">
              {copy.discardCheckoutPrompt}{' '}
              <button
                type="button"
                className="subpage-text-link"
                onClick={() => setDiscarding(true)}
                disabled={isBusy}
              >
                {busyAction === 'cancel' ? copy.cancelling : copy.discardCheckoutCta}
              </button>
            </p>
          ) : null}
        </>
      ) : null}

      {discarding ? (
        <ConfirmDialog
          copy={{
            title: copy.discardCheckoutTitle,
            body: copy.cancelConfirmPendingBody,
            confirm: copy.discardCheckoutYes,
            cancel: copy.cancelConfirmNo,
            busy: copy.cancelling,
            close: copy.close,
          }}
          isBusy={isBusy}
          onConfirm={() => {
            setDiscarding(false)
            onCancel()
          }}
          onCancel={() => setDiscarding(false)}
        />
      ) : null}
    </section>
  )
}

/**
 * The way back into an unfinished checkout: who it was opened for, and one button.
 *
 * Mercado Pago never tells us a checkout was turned away because the address did not
 * match — the payer just comes back with nothing done. So the address is always on
 * show, with "Cambiar" next to it (the "¿no es tu cuenta?" pattern), rather than a
 * warning that blames it. Left alone, the button goes straight back to the same
 * Mercado Pago page; with a different address typed in, it opens a new checkout for
 * that account instead — the server closes the old one first, so two are never payable
 * at once.
 */
function ResumeCheckout({
  copy,
  token,
  checkoutUrl,
  openedFor,
  payerEmailLocked,
  disabled,
}: {
  copy: SubscriptionPageCopy
  token: string | null
  checkoutUrl: string
  /** Null on checkouts opened before the address was stored. */
  openedFor: string | null
  payerEmailLocked: boolean
  disabled: boolean
}) {
  const [typedEmail, setTypedEmail] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [error, setError] = useState('')
  const [isRedirecting, setIsRedirecting] = useState(false)

  const email = typedEmail ?? openedFor ?? ''
  const isNewAddress =
    isEditing && !payerEmailLocked && email.trim().toLowerCase() !== (openedFor ?? '').toLowerCase()

  async function openForNewAddress() {
    const chosen = email.trim()
    if (!isPlausibleEmail(chosen)) {
      setEmailError(copy.payerEmailInvalid)
      return
    }
    if (!token) {
      return
    }

    setIsRedirecting(true)
    setError('')

    try {
      const where = await goToCheckout(async () => (await startCheckout(token, chosen)).initPoint)
      if (where === 'window') {
        // The new checkout is open in the other window; this screen catches up when the
        // person comes back to it (see useVistazo).
        setIsRedirecting(false)
        setIsEditing(false)
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_payer_email') {
        setEmailError(copy.payerEmailInvalid)
      } else {
        setError(checkoutErrorMessage(copy.checkoutErrors, copy.genericError, caught))
      }
      setIsRedirecting(false)
    }
  }

  return (
    <div className="subpage-banner-resume">
      {openedFor && token ? (
        <PayerEmailPicker
          copy={copy}
          email={email}
          isEditing={isEditing}
          locked={payerEmailLocked}
          error={emailError}
          disabled={disabled || isRedirecting}
          onEdit={() => setIsEditing(true)}
          onChange={(value) => {
            setTypedEmail(value)
            setEmailError('')
          }}
          onCancelEdit={() => {
            setIsEditing(false)
            setTypedEmail(null)
            setEmailError('')
          }}
        />
      ) : null}

      {/* The one case Mercado Pago refuses on its own page without telling us: the payer
          signed in with another account ("Tu e-mail no coincide con el de la
          suscripción"). They come back to this same unfinished checkout, so the way out is
          said right next to the address. */}
      {openedFor && token && !payerEmailLocked && !isEditing ? (
        <p className="subpage-banner-fineprint">{copy.payerEmailMismatchHint}</p>
      ) : null}

      {/* A plain link while the address is unchanged: it is the same Mercado Pago page as
          before, and a link keeps working without a round trip (or a middle click). On a
          desktop browser a plain click opens it in the checkout window instead. */}
      {isNewAddress ? (
        <button
          type="button"
          className="primary-button subpage-banner-cta"
          onClick={() => void openForNewAddress()}
          disabled={disabled || isRedirecting}
        >
          {isRedirecting ? copy.redirecting : copy.payerEmailContinue}
        </button>
      ) : (
        <a
          className="primary-button subpage-banner-cta"
          href={checkoutUrl}
          onClick={(event) => {
            if (prefersCheckoutWindow() && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
              event.preventDefault()
              void goToCheckout(() => checkoutUrl)
            }
          }}
        >
          {copy.resumeCheckoutCta}
        </a>
      )}

      {error ? <p className="plan-flow-error">{error}</p> : null}
    </div>
  )
}

/** The short-lived confirmation after cancelling — it says what was actually decided,
 * which "cancelada" alone does not. Gone on the next load of the overview. */
function CancellationNote({
  overview,
  copy,
  locale,
}: {
  overview: SubscriptionOverview
  copy: SubscriptionPageCopy
  locale: string
}) {
  const result = overview.cancellation
  if (!result) {
    return null
  }

  const message = result.nothingWillBeCharged
    ? copy.cancelledNothingCharged
    : result.accessUntilUtc
      ? fillTokens(copy.cancelledKeepsAccess, { date: formatBillingDate(result.accessUntilUtc, locale) })
      : copy.cancelledDone

  return <p className="subpage-note subpage-note-success">{message}</p>
}

function CurrentPlanSection({
  current,
  plan,
  copy,
  locale,
  overview,
  isBusy,
  busyAction,
  onCancel,
  onResume,
}: {
  current: SubscriptionRecord
  plan: SubscriptionOverview['plan'] | null
  copy: SubscriptionPageCopy
  locale: string
  overview: SubscriptionOverview | null
  isBusy: boolean
  busyAction: SubscriptionBusyAction | null
  onCancel: () => void
  onResume: () => void
}) {
  const [confirming, setConfirming] = useState<'cancel' | null>(null)
  const actions = overview?.actions ?? null
  const manageUrl = overview?.manageUrl ?? null

  return (
    <section className="subpage-section">
      <div className="subpage-section-head">
        <h2>{copy.currentPlanTitle}</h2>
        {current.lastSyncedAtUtc ? (
          <span className="subpage-muted">
            {copy.lastCheckedLabel}: {formatDateTime(current.lastSyncedAtUtc, locale)}
          </span>
        ) : null}
      </div>

      {overview?.accessFromAdminOverride ? <p className="subpage-note">{copy.adminNote}</p> : null}
      {current.isDevSimulated ? <p className="subpage-note">{copy.devNote}</p> : null}

      <div className="subpage-current">
        <div className="subpage-current-head">
          <p className="subpage-price">
            {formatMoney(current.amount || plan?.amount || 0, current.currencyId || plan?.currencyId || 'ARS', locale)}
            <small> {copy.perMonth}</small>
          </p>
          {current.trialWasApplied && current.status === 'trial' ? (
            <span className="subpage-trial-badge">{copy.freeTrialBadge}</span>
          ) : null}
        </div>

        <dl className="subpage-facts">
          {current.status === 'trial' && current.trialEndsAtUtc ? (
            <Fact label={copy.trialEndsOn} value={formatBillingDate(current.trialEndsAtUtc, locale)} />
          ) : null}
          {/* Renewal and expiry are the same date wearing different hats — which one it is
              depends on whether anything is still going to be charged. */}
          {current.nextBillingAtUtc ? (
            <Fact
              label={current.autoRenewEnabled ? copy.renewsOn : copy.endsOn}
              value={formatBillingDate(current.nextBillingAtUtc, locale)}
            />
          ) : null}
          {!current.nextBillingAtUtc && current.accessUntilUtc ? (
            <Fact label={copy.accessUntilLabel} value={formatBillingDate(current.accessUntilUtc, locale)} />
          ) : null}
          {current.status === 'pago_fallido' && current.graceEndsAtUtc ? (
            <Fact label={copy.graceUntil} value={formatDate(current.graceEndsAtUtc, locale)} />
          ) : null}
          {current.status === 'pausada' && current.pausedAtUtc ? (
            <Fact label={copy.pausedSince} value={formatDate(current.pausedAtUtc, locale)} />
          ) : null}
          {current.subscriptionStartsAtUtc ? (
            <Fact label={copy.startedOn} value={formatDate(current.subscriptionStartsAtUtc, locale)} />
          ) : null}
          {current.lastPaymentAtUtc ? <Fact label={copy.lastPayment} value={formatDate(current.lastPaymentAtUtc, locale)} /> : null}
          {current.paymentMethodLabel ? (
            <Fact label={copy.paymentMethod} value={formatPaymentMethod(current.paymentMethodLabel, copy.paymentMethods) ?? ''} />
          ) : null}
          <Fact label={copy.billedBy} value={current.autoRenewEnabled ? copy.autoRenewOn : copy.autoRenewOff} />
        </dl>
      </div>

      {/* The card lives in the payer's Mercado Pago account and there is no API to replace
          it, so this links out rather than pretending to be a form. */}
      {manageUrl && current.externalSubscriptionId ? (
        <div className="subpage-manage">
          <a className="ghost-button" href={manageUrl} target="_blank" rel="noreferrer noopener">
            {copy.changeCardCta}
          </a>
          <p className="subpage-muted">{copy.changeCardHint}</p>
        </div>
      ) : null}

      {actions && (actions.canResume || actions.canCancel) ? (
        <div className="subpage-actions">
          {actions.canResume ? (
            <button type="button" className="primary-button" onClick={onResume} disabled={isBusy}>
              {busyAction === 'resume' ? copy.resuming : copy.resumeCta}
            </button>
          ) : null}

          {actions.canCancel ? (
            <button
              type="button"
              className="ghost-button danger-button"
              onClick={() => setConfirming('cancel')}
              disabled={isBusy}
            >
              {busyAction === 'cancel' ? copy.cancelling : copy.cancelCta}
            </button>
          ) : null}
        </div>
      ) : null}

      {confirming === 'cancel' ? (
        <ConfirmDialog
          copy={{
            title: copy.cancelConfirmTitle,
            body: buildCancelBody(current, copy, locale),
            confirm: copy.cancelConfirmYes,
            cancel: copy.cancelConfirmNo,
            busy: copy.cancelling,
            close: copy.close,
          }}
          isBusy={isBusy}
          onConfirm={() => {
            setConfirming(null)
            onCancel()
          }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </section>
  )
}

/**
 * What cancelling actually costs, stated in the terms of the state being cancelled.
 * Inside the free week no money ever moves — Mercado Pago's engine is what schedules the
 * first debit and removing the preapproval means it is never attempted — and that is a
 * stronger, truer promise than the generic "no te volvemos a cobrar".
 */
function buildCancelBody(current: SubscriptionRecord, copy: SubscriptionPageCopy, locale: string): string {
  if (current.status === 'pendiente') {
    return copy.cancelConfirmPendingBody
  }

  const date = formatBillingDate(current.nextBillingAtUtc ?? current.trialEndsAtUtc, locale)
  const amount = formatMoney(current.amount, current.currencyId, locale)

  if (current.status === 'trial' && !current.lastPaymentAtUtc) {
    return fillTokens(copy.cancelConfirmTrialBody, { date, amount })
  }

  return fillTokens(copy.cancelConfirmBody, { date, amount })
}

/** The plan picker. Built as an expandable card — a "desplegable" — rather than a
 * flat block, so a second or third plan can slot in later without a redesign, even
 * though only one exists today. */
function PlansSection({
  copy,
  token,
  user,
  plan,
  locale,
  overview,
  title,
}: {
  copy: SubscriptionPageCopy
  token: string
  user: UserProfile
  plan: SubscriptionOverview['plan'] | null
  locale: string
  overview: SubscriptionOverview | null
  title: string
}) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <section className="subpage-section">
      <h2>{title}</h2>

      <div className="plan-card">
        <button type="button" className="plan-card-summary" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
          <span className="plan-card-name">{copy.planName}</span>
          <span className="plan-card-price">
            {plan ? formatMoney(plan.amount, plan.currencyId, 'es-AR') : '—'}
            <small> {copy.perMonth}</small>
          </span>
          <ChevronIcon className={isOpen ? 'is-open' : ''} />
        </button>

        {isOpen ? (
          <div className="plan-card-body">
            <PlanPurchaseFlow
              copy={copy}
              token={token}
              payerEmail={defaultPayerEmail(user, overview)}
              payerEmailLocked={Boolean(user.checkoutTestPayerEmail)}
              plan={plan}
              locale={locale}
              trialAvailable={Boolean(overview?.trialAvailable)}
              trialDeniedReason={overview?.trialDeniedReason ?? null}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** The raw provider trail. Behind a toggle: it is the thing that settles a billing dispute,
 * and also the thing nobody wants to scroll past on an ordinary visit. */
function EventsSection({
  overview,
  copy,
  locale,
}: {
  overview: SubscriptionOverview | null
  copy: SubscriptionPageCopy
  locale: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <section className="subpage-section subpage-section-muted">
      <div className="subpage-section-head">
        <h2>{copy.eventsTitle}</h2>
        <button type="button" className="ghost-button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
          {copy.eventsToggle}
        </button>
      </div>

      {isOpen ? (
        overview && overview.events.length > 0 ? (
          <ul className="subpage-list subpage-events">
            {overview.events.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.topic}</strong>
                  {item.action ? <span className="subpage-muted"> · {item.action}</span> : null}
                  {item.notes ? <p className="subpage-muted">{item.notes}</p> : null}
                </div>
                <span className="subpage-muted">{formatDateTime(item.createdAtUtc, locale)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subpage-muted-copy">{copy.noEvents}</p>
        )
      ) : null}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="subpage-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function InvoiceRow({ invoice, copy, locale }: { invoice: SubscriptionInvoice; copy: SubscriptionPageCopy; locale: string }) {
  const date = invoice.paidAtUtc ?? invoice.debitScheduledAtUtc ?? invoice.periodStartUtc ?? invoice.createdAtUtc
  // Only worth a line when the charge did not simply go through — "Aprobado · Acreditado"
  // is noise, "Rechazado · La tarjeta no tenía saldo suficiente" is the whole story.
  const detail =
    invoice.status !== 'aprobado' && invoice.statusDetail
      ? describePaymentReason(
          copy,
          invoice.statusDetail,
          invoice.status === 'devuelto' ? 'refunded' : null,
          {
            amount: formatMoney(invoice.amount, invoice.currencyId, locale),
            card: formatPaymentMethod(invoice.paymentMethodLabel, copy.paymentMethods),
          },
        ).reason
      : null

  return (
    <li>
      <div>
        <strong>{formatMoney(invoice.amount, invoice.currencyId, locale)}</strong>
        <span className={`invoice-status invoice-${invoice.status}`}>{copy.invoiceStatuses[invoice.status] ?? invoice.status}</span>
        {detail ? <p className="subpage-muted">{detail}</p> : null}
        {invoice.periodStartUtc && invoice.periodEndUtc ? (
          <p className="subpage-muted">
            {copy.invoicePeriod
              .replace('{from}', formatBillingDate(invoice.periodStartUtc, locale))
              .replace('{to}', formatBillingDate(invoice.periodEndUtc, locale))}
          </p>
        ) : null}
        {invoice.attemptNumber > 1 ? <p className="subpage-muted">{copy.invoiceAttempt.replace('{n}', String(invoice.attemptNumber))}</p> : null}
      </div>
      <span className="subpage-muted">{formatDate(date, locale)}</span>
    </li>
  )
}

function HistoryRow({ record, copy, locale }: { record: SubscriptionRecord; copy: SubscriptionPageCopy; locale: string }) {
  // Same split as the banner: an old row that never got past the checkout should read as
  // the attempt it was, not as a payment that is still somewhere in the system.
  const phase = phaseOf(record)
  const label =
    phase === 'processing'
      ? copy.processingStatus
      : phase === 'declined'
        ? copy.checkoutRejectedStatus
        : phase === 'checkout_open' || phase === 'abandoned'
          ? copy.checkoutOpenStatus
          : phase === 'ended'
            ? copy.endedStatus
            : copy.statuses[record.status] ?? record.status

  return (
    <li>
      <div>
        <strong>{label}</strong>
        {record.trialWasApplied ? <span className="subpage-trial-badge">{copy.freeTrialBadge}</span> : null}
        <p className="subpage-muted">
          {formatMoney(record.amount, record.currencyId, locale)} · {record.planType}
          {record.paymentProvider ? ` · ${record.paymentProvider}` : ''}
        </p>
      </div>
      <span className="subpage-muted">{formatDate(record.createdAtUtc, locale)}</span>
    </li>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`plan-card-chevron ${className}`}
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

interface BannerText {
  /** Picks the colours: `banner-…` and `status-…` in the stylesheet. */
  variant: string
  label: string
  hint: string
  next: string
  attention: boolean
}

/**
 * What the banner says for each phase. One place, so every case is visible side by side —
 * the wrong sentences this screen used to show ("no se te cobró nada" right after paying,
 * "conservás el acceso" weeks after it ended) came from cases nobody had put next to each
 * other.
 */
function describeBanner(
  current: SubscriptionRecord,
  phase: SubscriptionPhase,
  confirming: boolean,
  copy: SubscriptionPageCopy,
  locale: string,
): BannerText {
  const amount = formatMoney(current.amount, current.currencyId, locale)
  const accessEnd = formatBillingDate(current.accessUntilUtc ?? current.nextBillingAtUtc ?? current.trialEndsAtUtc, locale)
  const statusText = (status: string) => ({
    label: copy.statuses[status] ?? status,
    hint: copy.statusHints[status] ?? '',
    next: fillTokens(copy.statusNext[status] ?? '', {
      date: formatBillingDate(current.nextBillingAtUtc ?? current.trialEndsAtUtc, locale),
      amount,
    }),
  })

  switch (phase) {
    case 'processing':
      return { variant: 'pendiente', label: copy.processingStatus, hint: copy.processingHint, next: copy.processingNext, attention: true }
    case 'checkout_open':
      // Back from Mercado Pago a moment ago, and it has not said yet how it went. "No lo
      // terminaste" is the one guess that must not be made to someone who may have just
      // paid; the screen keeps asking, and only says it once it has stopped.
      return confirming
        ? { variant: 'pendiente', label: copy.confirmingStatus, hint: copy.confirmingHint, next: copy.confirmingNext, attention: true }
        : { variant: 'checkout_abierto', label: copy.checkoutOpenStatus, hint: copy.checkoutOpenHint, next: copy.checkoutOpenNext, attention: false }
    case 'declined':
      // The payer did finish and the charge bounced. Red, because that is what it is, but
      // its own words: nothing was ever paid, so there is no access to keep.
      return { variant: 'pago_fallido', label: copy.checkoutRejectedStatus, hint: copy.checkoutRejectedHint, next: '', attention: true }
    case 'cancelled':
      return {
        variant: 'cancelada',
        label: copy.statuses.cancelada ?? 'cancelada',
        hint: fillTokens(copy.cancelledHint, { date: accessEnd }),
        next: fillTokens(copy.cancelledNext, { date: accessEnd }),
        attention: false,
      }
    case 'ended':
      return {
        variant: 'cancelada',
        label: copy.endedStatus,
        hint: fillTokens(copy.endedHint, {
          date: formatBillingDate(current.nextBillingAtUtc ?? current.trialEndsAtUtc ?? current.cancelledAtUtc, locale),
        }),
        next: copy.endedNext,
        attention: false,
      }
    case 'pago_fallido':
      return current.hasAccess
        ? { variant: 'pago_fallido', ...statusText('pago_fallido'), attention: true }
        : { variant: 'pago_fallido', ...statusText('pago_fallido'), hint: copy.paymentFailedLockedHint, attention: true }
    case 'pausada':
      return current.hasAccess
        ? { variant: 'pausada', ...statusText('pausada'), attention: false }
        : { variant: 'pausada', ...statusText('pausada'), hint: copy.pausedLockedHint, attention: false }
    default:
      return { variant: phase, ...statusText(phase), attention: false }
  }
}

/** `{name}` substitution. Kept dumb on purpose — the copy owns the sentence, this only
 * fills the holes, so a translation can move the date to the front without code changes. */
function fillTokens(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(value), template)
}

/** Days left, rounded up: someone whose access ends in nine hours has "1 día", not zero. */
function formatRemaining(untilUtc: string, copy: SubscriptionPageCopy): string {
  const days = Math.ceil((new Date(untilUtc).getTime() - Date.now()) / 86_400_000)

  if (days <= 0) {
    return copy.lastDay
  }
  if (days === 1) {
    return copy.oneDayLeft
  }
  return copy.daysLeft.replace('{n}', String(days))
}

function formatDate(value: string | null, locale: string): string {
  if (!value) {
    return '—'
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value))
}

/**
 * A date Mercado Pago bills on — the end of the free week, the next debit, the end of a
 * paid period — read the way Mercado Pago reads it: by its UTC calendar day. Its checkout,
 * its emails and its own account page all say "23 de noviembre" for a debit due at 02:47
 * UTC, which is still the 22nd in Argentina, and the same subscription read "22 nov" here.
 * Two dates for one charge is the one thing a billing screen cannot afford.
 */
function formatBillingDate(value: string | null, locale: string): string {
  if (!value) {
    return '—'
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
}

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
