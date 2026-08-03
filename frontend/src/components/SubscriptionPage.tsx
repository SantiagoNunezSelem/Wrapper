import { useState } from 'react'
import { PlanPurchaseFlow, type PlanPurchaseFlowCopy } from './PlanPurchaseFlow'
import type {
  Language,
  SubscriptionInvoice,
  SubscriptionOverview,
  SubscriptionRecord,
  UserProfile,
} from '../types'

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
  cancelCta: string
  cancelConfirmTitle: string
  cancelConfirmBody: string
  cancelConfirmYes: string
  cancelConfirmNo: string
  refreshCta: string
  refreshing: string
  cancelling: string
  billedBy: string
  autoRenewOn: string
  autoRenewOff: string
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
  noEvents: string
}

/**
 * The subscription/billing screen: its own route (`/suscripcion`), not a modal, because
 * it is the one part of the product that plays the role of a menu — plan, price,
 * cancellation, billing history — rather than the playful "Wrapped" experience. The
 * visual language is deliberately calmer than the rest of the app: solid panels, no
 * gradients on headings, no confetti.
 *
 * Plan details render inline here, but buying itself always happens in the same popup
 * "Desbloquear VIP" opens (`onStartPurchase` — see `App.tsx`'s `openVipPopover`), so the
 * payment step never appears inline on this page. Never a redirect either way.
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
  onStartPurchase,
  onPurchaseSuccess,
  onCancel,
  onRefresh,
  onSignIn,
}: {
  language: Language
  copy: SubscriptionPageCopy
  user: UserProfile | null
  token: string | null
  overview: SubscriptionOverview | null
  busyAction: 'cancel' | 'refresh' | null
  error: string
  onBack: () => void
  onLanguageToggle: () => void
  onStartPurchase: () => void
  onPurchaseSuccess: (overview: SubscriptionOverview) => void
  onCancel: () => void
  onRefresh: () => void
  onSignIn: () => void
}) {
  const isBusy = busyAction !== null
  const current = overview?.current ?? null
  const plan = overview?.plan ?? null
  const locale = language === 'es' ? 'es-AR' : 'en-US'

  const canCancel =
    current !== null &&
    !overview?.accessFromAdminOverride &&
    ['trial', 'activa', 'pago_fallido', 'pausada'].includes(current.status)

  const canSubscribe = current === null || ['inactiva', 'cancelada', 'pendiente'].includes(current.status)

  return (
    <div className="subpage">
      <header className="subpage-header">
        <button type="button" className="subpage-back" onClick={onBack}>
          <BackIcon />
          {copy.backToApp}
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

        {!user ? (
          <section className="subpage-section subpage-signin">
            <p>{copy.signInPrompt}</p>
            <button type="button" className="primary-button" onClick={onSignIn}>
              {copy.signInCta}
            </button>
          </section>
        ) : null}

        {current ? (
          <CurrentPlanSection
            current={current}
            plan={plan}
            copy={copy}
            locale={locale}
            overview={overview}
            isBusy={isBusy}
            busyAction={busyAction}
            canCancel={canCancel}
            onCancel={onCancel}
            onRefresh={onRefresh}
          />
        ) : null}

        {user && token && canSubscribe ? (
          <PlansSection
            copy={copy}
            token={token}
            userEmail={user.email}
            plan={plan}
            overview={overview}
            onSuccess={onPurchaseSuccess}
            onStartPurchase={onStartPurchase}
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

            <section className="subpage-section subpage-section-muted">
              <h2>{copy.eventsTitle}</h2>
              {overview && overview.events.length > 0 ? (
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
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

function CurrentPlanSection({
  current,
  plan,
  copy,
  locale,
  overview,
  isBusy,
  busyAction,
  canCancel,
  onCancel,
  onRefresh,
}: {
  current: NonNullable<SubscriptionOverview['current']>
  plan: SubscriptionOverview['plan'] | null
  copy: SubscriptionPageCopy
  locale: string
  overview: SubscriptionOverview | null
  isBusy: boolean
  busyAction: 'cancel' | 'refresh' | null
  canCancel: boolean
  onCancel: () => void
  onRefresh: () => void
}) {
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false)

  return (
    <section className="subpage-section">
      <div className="subpage-section-head">
        <h2>{copy.currentPlanTitle}</h2>
        <button type="button" className="ghost-button" onClick={onRefresh} disabled={isBusy}>
          {busyAction === 'refresh' ? copy.refreshing : copy.refreshCta}
        </button>
      </div>

      {overview?.accessFromAdminOverride ? <p className="subpage-note">{copy.adminNote}</p> : null}
      {current.isDevSimulated ? <p className="subpage-note">{copy.devNote}</p> : null}

      <div className="subpage-current">
        <div className="subpage-current-head">
          <span className={`subpage-status status-${current.status}`}>{copy.statuses[current.status] ?? current.status}</span>
          {current.trialWasApplied && current.status === 'trial' ? (
            <span className="subpage-trial-badge">{copy.freeTrialBadge}</span>
          ) : null}
        </div>

        <p className="subpage-price">
          {formatMoney(current.amount || plan?.amount || 0, current.currencyId || plan?.currencyId || 'ARS', locale)}
          <small> {copy.perMonth}</small>
        </p>

        {copy.statusHints[current.status] ? <p className="subpage-hint">{copy.statusHints[current.status]}</p> : null}

        <dl className="subpage-facts">
          {current.status === 'trial' && current.trialEndsAtUtc ? (
            <Fact label={copy.trialEndsOn} value={formatDate(current.trialEndsAtUtc, locale)} />
          ) : null}
          {current.nextBillingAtUtc ? (
            <Fact
              label={current.status === 'cancelada' || current.status === 'pausada' ? copy.endsOn : copy.renewsOn}
              value={formatDate(current.nextBillingAtUtc, locale)}
            />
          ) : null}
          {current.status === 'pago_fallido' && current.graceEndsAtUtc ? (
            <Fact label={copy.graceUntil} value={formatDate(current.graceEndsAtUtc, locale)} />
          ) : null}
          {current.subscriptionStartsAtUtc ? (
            <Fact label={copy.startedOn} value={formatDate(current.subscriptionStartsAtUtc, locale)} />
          ) : null}
          {current.lastPaymentAtUtc ? <Fact label={copy.lastPayment} value={formatDate(current.lastPaymentAtUtc, locale)} /> : null}
          {current.paymentMethodLabel ? <Fact label={copy.paymentMethod} value={current.paymentMethodLabel} /> : null}
          <Fact
            label={copy.billedBy}
            value={current.status === 'cancelada' || current.status === 'pausada' ? copy.autoRenewOff : copy.autoRenewOn}
          />
        </dl>
      </div>

      {canCancel ? (
        <div className="subpage-actions">
          <button type="button" className="ghost-button danger-button" onClick={() => setIsConfirmingCancel(true)} disabled={isBusy}>
            {busyAction === 'cancel' ? copy.cancelling : copy.cancelCta}
          </button>
        </div>
      ) : null}

      {isConfirmingCancel ? (
        <div className="modal-backdrop nested-backdrop" role="presentation" onClick={() => setIsConfirmingCancel(false)}>
          <section className="modal-card confirm-card" onClick={(event) => event.stopPropagation()}>
            <h3>{copy.cancelConfirmTitle}</h3>
            <p className="panel-copy">
              {copy.cancelConfirmBody.replace(
                '{date}',
                current.nextBillingAtUtc
                  ? formatDate(current.nextBillingAtUtc, locale)
                  : current.trialEndsAtUtc
                    ? formatDate(current.trialEndsAtUtc, locale)
                    : '—',
              )}
            </p>
            <div className="consent-actions">
              <button
                type="button"
                className="primary-button danger-button"
                onClick={() => {
                  setIsConfirmingCancel(false)
                  onCancel()
                }}
                disabled={isBusy}
              >
                {copy.cancelConfirmYes}
              </button>
              <button type="button" className="ghost-button" onClick={() => setIsConfirmingCancel(false)}>
                {copy.cancelConfirmNo}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
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
  onSuccess,
  onStartPurchase,
}: {
  copy: SubscriptionPageCopy
  token: string
  userEmail: string
  plan: SubscriptionOverview['plan'] | null
  overview: SubscriptionOverview | null
  onSuccess: (overview: SubscriptionOverview) => void
  onStartPurchase: () => void
}) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <section className="subpage-section">
      <h2>{copy.plansTitle}</h2>

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
              onSuccess={onSuccess}
              onRequestExternalCheckout={onStartPurchase}
            />
          </div>
        ) : null}
      </div>
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

  return (
    <li>
      <div>
        <strong>{formatMoney(invoice.amount, invoice.currencyId, locale)}</strong>
        <span className={`invoice-status invoice-${invoice.status}`}>{copy.invoiceStatuses[invoice.status] ?? invoice.status}</span>
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

function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
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
