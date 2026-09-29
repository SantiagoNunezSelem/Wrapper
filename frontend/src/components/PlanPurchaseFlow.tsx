import { useId, useState } from 'react'
import { ApiError, startCheckout } from '../lib/api'
import { goToCheckout, prefersCheckoutWindow } from '../lib/checkoutWindow'
import { formatMoney } from '../lib/format'
import { isPlausibleEmail } from '../lib/payerEmail'
import { checkoutErrorMessage } from '../lib/paymentReasons'
import type { SubscriptionPlan } from '../types'

export interface PlanPurchaseFlowCopy {
  planName: string
  perMonth: string
  planDurationLabel: string
  planDurationValue: string
  planAccessLabel: string
  planAccessValue: string
  trialToday: string
  trialTodayDetail: string
  trialFirstCharge: string
  trialCancelBefore: string
  checkoutHintWindow: string
  checkoutHintRedirect: string
  checkoutWindowWaiting: string
  checkoutWindowReopen: string
  planBenefitsLabel: string
  planBenefits: readonly string[]
  payerEmailLabel: string
  payerEmailChange: string
  payerEmailInputLabel: string
  payerEmailHint: string
  payerEmailInvalid: string
  payerEmailCancel: string
  buyCta: string
  buyTrialCta: string
  trialUnavailable: string
  trialReasons: Record<string, string>
  paymentsDisabled: string
  redirecting: string
  genericError: string
  /** By the code the server answers with when a checkout does not open. */
  checkoutErrors: Record<string, string>
}

/**
 * The plan card plus its "buy" button. Used both by the full `/suscripcion` page (inside
 * its collapsible plan card) and by the quick popover a locked metric's "Desbloquear VIP"
 * opens — same component, same behaviour, no navigation between them.
 *
 * Buying itself is not something that happens on this page: the button opens a checkout
 * on Mercado Pago's side and sends the person to their hosted page (card form, 3-D
 * Secure, all of it lives there, never embedded here). On a desktop browser that page
 * opens in a window of its own and this one stays, saying where the payment went; on a
 * phone or in the installed app the tab itself goes there (see lib/checkoutWindow).
 *
 * The one thing asked before leaving is which Mercado Pago account will pay. Mercado Pago
 * only lets the account whose address the checkout was opened for authorise it, and it
 * turns everyone else away on its own page with no way back. The address is shown
 * already filled in, so the many people whose Mercado Pago is their Google address just
 * press the button; the rest change it here instead of finding out there.
 */
export function PlanPurchaseFlow({
  copy,
  token,
  payerEmail,
  payerEmailLocked,
  plan,
  locale,
  trialAvailable,
  trialDeniedReason,
}: {
  copy: PlanPurchaseFlowCopy
  token: string
  locale: string
  /** Pre-filled address; see `defaultPayerEmail`. */
  payerEmail: string
  /** `MercadoPago:TestPayerEmail` is set: the server ignores anything typed, so no field. */
  payerEmailLocked: boolean
  plan: SubscriptionPlan | null
  trialAvailable: boolean
  trialDeniedReason: string | null
}) {
  const [error, setError] = useState('')
  const [isRedirecting, setIsRedirecting] = useState(false)
  // Only what the person typed is state; until then the prop is shown, so an overview
  // that arrives after the first render still fills in the right address.
  const [typedEmail, setTypedEmail] = useState<string | null>(null)
  const [isEditingEmail, setIsEditingEmail] = useState(false)
  const [emailError, setEmailError] = useState('')
  const email = typedEmail ?? payerEmail

  // Set once the checkout is running in a window of its own: this page stays, so it has
  // to say where the payment went, and offer a way back to that window.
  const [openWindowUrl, setOpenWindowUrl] = useState<string | null>(null)
  const inWindow = prefersCheckoutWindow()

  async function handleBuy() {
    const chosen = email.trim()
    if (!payerEmailLocked && !isPlausibleEmail(chosen)) {
      setIsEditingEmail(true)
      setEmailError(copy.payerEmailInvalid)
      return
    }

    setIsRedirecting(true)
    setError('')

    try {
      let initPoint = ''
      const where = await goToCheckout(async () => {
        initPoint = (await startCheckout(token, payerEmailLocked ? undefined : chosen)).initPoint
        return initPoint
      })
      if (where === 'window') {
        setOpenWindowUrl(initPoint)
        setIsRedirecting(false)
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_payer_email') {
        setIsEditingEmail(true)
        setEmailError(copy.payerEmailInvalid)
      } else {
        setError(checkoutErrorMessage(copy.checkoutErrors, copy.genericError, caught))
      }
      setIsRedirecting(false)
    }
  }

  return (
    <div className="plan-flow-details">
      <dl className="plan-card-facts">
        <div>
          <dt>{copy.planDurationLabel}</dt>
          <dd>{copy.planDurationValue}</dd>
        </div>
        <div>
          <dt>{copy.planAccessLabel}</dt>
          <dd>{copy.planAccessValue}</dd>
        </div>
      </dl>

      {trialAvailable && plan ? <TrialTimeline copy={copy} plan={plan} locale={locale} /> : null}

      <div className="plan-card-benefits">
        <p className="plan-card-benefits-label">{copy.planBenefitsLabel}</p>
        <ul>
          {copy.planBenefits.map((benefit) => (
            <li key={benefit}>
              <CheckIcon />
              {benefit}
            </li>
          ))}
        </ul>
      </div>

      {plan?.providerConfigured ? (
        <>
          <PayerEmailPicker
            copy={copy}
            email={email}
            isEditing={isEditingEmail}
            locked={payerEmailLocked}
            error={emailError}
            disabled={isRedirecting || openWindowUrl !== null}
            onEdit={() => setIsEditingEmail(true)}
            onChange={(value) => {
              setTypedEmail(value)
              setEmailError('')
            }}
            onCancelEdit={() => {
              setIsEditingEmail(false)
              setTypedEmail(null)
              setEmailError('')
            }}
          />

          {openWindowUrl ? (
            <div className="plan-window-wait" role="status">
              <p>{copy.checkoutWindowWaiting}</p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => void goToCheckout(() => openWindowUrl)}
              >
                {copy.checkoutWindowReopen}
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="primary-button plan-card-cta" onClick={handleBuy} disabled={isRedirecting}>
                {isRedirecting ? copy.redirecting : trialAvailable ? copy.buyTrialCta : copy.buyCta}
              </button>
              <p className="plan-card-hint">{inWindow ? copy.checkoutHintWindow : copy.checkoutHintRedirect}</p>
            </>
          )}
        </>
      ) : (
        <p className="plan-card-hint">{copy.paymentsDisabled}</p>
      )}

      {!trialAvailable && trialDeniedReason ? (
        <p className="plan-card-hint">
          {copy.trialUnavailable} {copy.trialReasons[trialDeniedReason] ?? ''}
        </p>
      ) : null}

      {error ? <p className="plan-flow-error">{error}</p> : null}
    </div>
  )
}

type PayerEmailCopy = Pick<
  PlanPurchaseFlowCopy,
  'payerEmailLabel' | 'payerEmailChange' | 'payerEmailInputLabel' | 'payerEmailHint' | 'payerEmailCancel'
>

/**
 * "Vas a pagar con la cuenta de Mercado Pago — ana@gmail.com · Cambiar": the identity
 * line, and the field it turns into. Shared by the plan card and the unfinished-checkout
 * banner so both read the same. Controlled: whoever owns the button that leaves for
 * Mercado Pago owns the address too.
 */
export function PayerEmailPicker({
  copy,
  email,
  isEditing,
  locked,
  error,
  disabled,
  onEdit,
  onChange,
  onCancelEdit,
}: {
  copy: PayerEmailCopy
  email: string
  isEditing: boolean
  /** `MercadoPago:TestPayerEmail` is set: shown, never editable. */
  locked: boolean
  error: string
  disabled: boolean
  onEdit: () => void
  onChange: (value: string) => void
  onCancelEdit: () => void
}) {
  if (isEditing && !locked) {
    return (
      <PayerEmailField
        copy={copy}
        value={email}
        error={error}
        disabled={disabled}
        onChange={onChange}
        onCancel={onCancelEdit}
      />
    )
  }

  return (
    <div className="plan-payer">
      <div className="plan-payer-text">
        <span className="plan-payer-label">{copy.payerEmailLabel}</span>
        <span className="plan-payer-email">{email}</span>
      </div>
      {locked ? null : (
        <button type="button" className="plan-payer-change" onClick={onEdit} disabled={disabled}>
          {copy.payerEmailChange}
        </button>
      )}
    </div>
  )
}

function PayerEmailField({
  copy,
  value,
  error,
  disabled,
  onChange,
  onCancel,
}: {
  copy: PayerEmailCopy
  value: string
  error: string
  disabled: boolean
  onChange: (value: string) => void
  onCancel: () => void
}) {
  const id = useId()

  return (
    <div className="plan-payer-field">
      <div className="plan-payer-field-head">
        <label className="plan-payer-field-label" htmlFor={id}>
          {copy.payerEmailInputLabel}
        </label>
        <button type="button" className="plan-payer-change" onClick={onCancel} disabled={disabled}>
          {copy.payerEmailCancel}
        </button>
      </div>
      <input
        id={id}
        type="email"
        className="word-search-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="email"
        inputMode="email"
        maxLength={320}
        autoFocus
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
      />
      {error ? (
        <span id={`${id}-error`} className="plan-payer-field-error" role="alert">
          {error}
        </span>
      ) : null}
      <span id={`${id}-hint`} className="plan-payer-field-hint">
        {copy.payerEmailHint}
      </span>
    </div>
  )
}

/**
 * "Hoy: sin cargo · 6 oct: primer cobro de $ 4.990" — the free week as dates and an
 * amount, before the button rather than after it. "7 días gratis" alone leaves the one
 * question that matters (when do I get charged, and how much) for the person to work out.
 *
 * The date is counted from today, which is when Mercado Pago starts the week if the
 * checkout is finished now; it is an estimate for a page, the account screen shows the
 * real one once the subscription exists.
 */
function TrialTimeline({
  copy,
  plan,
  locale,
}: {
  copy: Pick<PlanPurchaseFlowCopy, 'trialToday' | 'trialTodayDetail' | 'trialFirstCharge' | 'trialCancelBefore'>
  plan: SubscriptionPlan
  locale: string
}) {
  const firstCharge = new Date()
  if (plan.trialFrequencyType === 'months') {
    firstCharge.setMonth(firstCharge.getMonth() + plan.trialFrequency)
  } else {
    firstCharge.setDate(firstCharge.getDate() + plan.trialFrequency)
  }

  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(firstCharge)
  const amount = formatMoney(plan.amount, plan.currencyId, locale)

  return (
    <div className="plan-trial">
      <ol className="plan-trial-steps">
        <li className="is-now">
          <span className="plan-trial-when">{copy.trialToday}</span>
          <span className="plan-trial-what">{copy.trialTodayDetail}</span>
        </li>
        <li>
          <span className="plan-trial-when">{date}</span>
          <span className="plan-trial-what">{copy.trialFirstCharge.replace('{amount}', amount)}</span>
        </li>
      </ol>
      <p className="plan-trial-note">{copy.trialCancelBefore.replace('{date}', date)}</p>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}
