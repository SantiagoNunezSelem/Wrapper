import { useState } from 'react'
import { formatMoney } from '../lib/format'
import { ConfirmDialog } from './ConfirmDialog'
import { ModalShell } from './ModalShell'
import { PlanPurchaseFlow, type PlanPurchaseFlowCopy } from './PlanPurchaseFlow'
import type {
  Language,
  SubscriptionInvoice,
  SubscriptionOverview,
  SubscriptionRecord,
  UserProfile,
} from '../types'

/** Every action the account screen can be waiting on. */
export type SubscriptionBusyAction = 'cancel' | 'refresh' | 'pause' | 'resume'

export interface SubscriptionPageCopy extends PlanPurchaseFlowCopy {
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
  resumeCheckoutCta: string
  resumeCheckoutHint: string
  alreadyPaidNote: string
  checkingStatus: string
  currentPlanTitle: string
  perMonth: string
  freeTrialBadge: string
  trialEndsOn: string
  renewsOn: string
  endsOn: string
  graceUntil: string
  paymentMethod: string
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
  cancelConfirmYes: string
  cancelConfirmNo: string
  cancelledNothingCharged: string
  cancelledKeepsAccess: string
  cancelledDone: string
  pauseCta: string
  pausing: string
  pauseConfirmTitle: string
  pauseConfirmBody: string
  pauseConfirmYes: string
  pauseHint: string
  resumeCta: string
  resuming: string
  refreshCta: string
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
  onPause,
  onResume,
  onRefresh,
  onSignIn,
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
  onPause: () => void
  onResume: () => void
  onRefresh: () => void
  onSignIn: () => void
}) {
  const isBusy = busyAction !== null
  const current = overview?.current ?? null
  const plan = overview?.plan ?? null
  const actions = overview?.actions ?? null
  const locale = language === 'es' ? 'es-AR' : 'en-US'

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
          {user ? <span className="subpage-account-chip">{user.displayName}</span> : null}
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
        {overview?.cancellation ? <CancellationNote overview={overview} copy={copy} locale={locale} /> : null}

        {!user ? (
          <section className="subpage-section subpage-signin">
            <p>{copy.signInPrompt}</p>
            <button type="button" className="primary-button" onClick={onSignIn}>
              {copy.signInCta}
            </button>
          </section>
        ) : null}

        {current ? (
          <>
            <StatusBanner
              current={current}
              copy={copy}
              locale={locale}
              isBusy={isBusy}
              busyAction={busyAction}
              canResumeCheckout={Boolean(actions?.canResumeCheckout)}
              onRefresh={onRefresh}
            />

            <CurrentPlanSection
              current={current}
              plan={plan}
              copy={copy}
              locale={locale}
              overview={overview}
              isBusy={isBusy}
              busyAction={busyAction}
              onCancel={onCancel}
              onPause={onPause}
              onResume={onResume}
            />
          </>
        ) : null}

        {user && token && (actions?.canSubscribe ?? current === null) ? (
          <PlansSection
            copy={copy}
            token={token}
            userEmail={user.email}
            plan={plan}
            overview={overview}
            title={current ? copy.resubscribeTitle : copy.plansTitle}
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

            <EventsSection overview={overview} copy={copy} locale={locale} />
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
  copy,
  locale,
  isBusy,
  busyAction,
  canResumeCheckout,
  onRefresh,
}: {
  current: SubscriptionRecord
  copy: SubscriptionPageCopy
  locale: string
  isBusy: boolean
  busyAction: SubscriptionBusyAction | null
  canResumeCheckout: boolean
  onRefresh: () => void
}) {
  const needsAttention = current.status === 'pendiente' || current.status === 'pago_fallido'
  const nextStep = fillTokens(copy.statusNext[current.status] ?? '', {
    date: formatDate(current.nextBillingAtUtc ?? current.trialEndsAtUtc, locale),
    amount: formatMoney(current.amount, current.currencyId, locale),
  })

  return (
    <section className={`subpage-banner ${needsAttention ? 'is-attention' : 'is-calm'} banner-${current.status}`}>
      <div className="subpage-banner-head">
        <span className={`subpage-status status-${current.status}`}>
          {copy.statuses[current.status] ?? current.status}
        </span>
        {current.hasAccess && current.accessUntilUtc ? (
          <span className="subpage-banner-countdown">{formatRemaining(current.accessUntilUtc, copy)}</span>
        ) : null}
      </div>

      {copy.statusHints[current.status] ? <p className="subpage-banner-body">{copy.statusHints[current.status]}</p> : null}
      {nextStep ? <p className="subpage-banner-next">{nextStep}</p> : null}

      {/* Only ever shown with a real status_detail behind it: inventing a reason is worse
          than saying nothing, and the fallback already covers "no sabemos todavía". */}
      {current.pendingReason ? (
        <p className="subpage-banner-reason">
          <strong>{copy.pendingReasonLabel}:</strong>{' '}
          {copy.pendingReasons[current.pendingReason] ?? copy.pendingReasonFallback}
        </p>
      ) : null}

      {current.status === 'pendiente' ? (
        <>
          <div className="subpage-banner-actions">
            {canResumeCheckout && current.checkoutUrl ? (
              <a className="primary-button" href={current.checkoutUrl}>
                {copy.resumeCheckoutCta}
              </a>
            ) : null}
            <button type="button" className="ghost-button" onClick={onRefresh} disabled={isBusy}>
              {busyAction === 'refresh' ? copy.checkingStatus : copy.refreshCta}
            </button>
          </div>
          {canResumeCheckout && current.checkoutUrl ? (
            <p className="subpage-banner-fineprint">{copy.resumeCheckoutHint}</p>
          ) : null}
          <p className="subpage-banner-fineprint">{copy.alreadyPaidNote}</p>
        </>
      ) : null}
    </section>
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
      ? fillTokens(copy.cancelledKeepsAccess, { date: formatDate(result.accessUntilUtc, locale) })
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
  onPause,
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
  onPause: () => void
  onResume: () => void
}) {
  const [confirming, setConfirming] = useState<'cancel' | 'pause' | null>(null)
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
            <Fact label={copy.trialEndsOn} value={formatDate(current.trialEndsAtUtc, locale)} />
          ) : null}
          {/* Renewal and expiry are the same date wearing different hats — which one it is
              depends on whether anything is still going to be charged. */}
          {current.nextBillingAtUtc ? (
            <Fact
              label={current.autoRenewEnabled ? copy.renewsOn : copy.endsOn}
              value={formatDate(current.nextBillingAtUtc, locale)}
            />
          ) : null}
          {!current.nextBillingAtUtc && current.accessUntilUtc ? (
            <Fact label={copy.accessUntilLabel} value={formatDate(current.accessUntilUtc, locale)} />
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
          {current.paymentMethodLabel ? <Fact label={copy.paymentMethod} value={current.paymentMethodLabel} /> : null}
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

      {actions && (actions.canResume || actions.canPause || actions.canCancel) ? (
        <div className="subpage-actions">
          {actions.canResume ? (
            <button type="button" className="primary-button" onClick={onResume} disabled={isBusy}>
              {busyAction === 'resume' ? copy.resuming : copy.resumeCta}
            </button>
          ) : null}

          {actions.canPause ? (
            <button type="button" className="ghost-button" onClick={() => setConfirming('pause')} disabled={isBusy}>
              {busyAction === 'pause' ? copy.pausing : copy.pauseCta}
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

      {/* Offered next to "cancelar", where the decision is actually being made. */}
      {actions?.canPause ? <p className="subpage-muted-copy">{copy.pauseHint}</p> : null}

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

      {confirming === 'pause' ? (
        <PauseConfirmDialog
          copy={copy}
          body={fillTokens(copy.pauseConfirmBody, {
            date: formatDate(current.accessUntilUtc ?? current.nextBillingAtUtc ?? current.trialEndsAtUtc, locale),
          })}
          isBusy={isBusy}
          onConfirm={() => {
            setConfirming(null)
            onPause()
          }}
          onDismiss={() => setConfirming(null)}
        />
      ) : null}
    </section>
  )
}

/**
 * Pausing is not a destructive action — the shared `ConfirmDialog` always renders its
 * confirm button as `is-danger`, which would misrepresent it as one — so this builds
 * directly on `ModalShell` instead, the same way `FreeUnlockConfirm` does for its own
 * non-destructive confirm.
 */
function PauseConfirmDialog({
  copy,
  body,
  isBusy,
  onConfirm,
  onDismiss,
}: {
  copy: SubscriptionPageCopy
  body: string
  isBusy: boolean
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <ModalShell onDismiss={onDismiss} label={copy.pauseConfirmTitle} className="confirm-modal" closeLabel={copy.close}>
      <h2>{copy.pauseConfirmTitle}</h2>
      <p className="panel-copy">{body}</p>

      <div className="free-unlock-actions">
        <button type="button" className="ghost-button" onClick={onDismiss} disabled={isBusy}>
          {copy.cancelConfirmNo}
        </button>
        <button type="button" className="primary-button" onClick={onConfirm} disabled={isBusy}>
          {isBusy ? copy.pausing : copy.pauseConfirmYes}
        </button>
      </div>
    </ModalShell>
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

  const date = formatDate(current.nextBillingAtUtc ?? current.trialEndsAtUtc, locale)
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
  userEmail,
  plan,
  overview,
  title,
}: {
  copy: SubscriptionPageCopy
  token: string
  userEmail: string
  plan: SubscriptionOverview['plan'] | null
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
              userEmail={userEmail}
              plan={plan}
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
  const detail = invoice.status !== 'aprobado' && invoice.statusDetail ? copy.pendingReasons[invoice.statusDetail] : null

  return (
    <li>
      <div>
        <strong>{formatMoney(invoice.amount, invoice.currencyId, locale)}</strong>
        <span className={`invoice-status invoice-${invoice.status}`}>{copy.invoiceStatuses[invoice.status] ?? invoice.status}</span>
        {detail ? <p className="subpage-muted">{detail}</p> : null}
        {invoice.periodStartUtc && invoice.periodEndUtc ? (
          <p className="subpage-muted">
            {copy.invoicePeriod
              .replace('{from}', formatDate(invoice.periodStartUtc, locale))
              .replace('{to}', formatDate(invoice.periodEndUtc, locale))}
          </p>
        ) : null}
        {invoice.attemptNumber > 1 ? <p className="subpage-muted">{copy.invoiceAttempt.replace('{n}', String(invoice.attemptNumber))}</p> : null}
      </div>
      <span className="subpage-muted">{formatDate(date, locale)}</span>
    </li>
  )
}

function HistoryRow({ record, copy, locale }: { record: SubscriptionRecord; copy: SubscriptionPageCopy; locale: string }) {
  return (
    <li>
      <div>
        <strong>{copy.statuses[record.status] ?? record.status}</strong>
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

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
