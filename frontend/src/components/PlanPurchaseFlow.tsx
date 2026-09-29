import { useId, useState } from 'react'
import { ApiError, startCheckout } from '../lib/api'
import { isPlausibleEmail } from '../lib/payerEmail'
import type { SubscriptionPlan } from '../types'

export interface PlanPurchaseFlowCopy {
  planName: string
  perMonth: string
  planDurationLabel: string
  planDurationValue: string
  planAccessLabel: string
  planAccessValue: string
  planTrialNote: string
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
}

/**
 * The plan card plus its "buy" button. Used both by the full `/suscripcion` page (inside
 * its collapsible plan card) and by the quick popover a locked metric's "Desbloquear VIP"
 * opens — same component, same behaviour, no navigation between them.
 *
 * Buying itself is not something that happens on this page: the button opens a checkout
 * on Mercado Pago's side and immediately sends the browser to their hosted page (card
 * form, 3-D Secure, all of it lives there, never embedded here). There is nothing to show
 * afterwards in this component — this tab is about to navigate away — so the only local
 * state is the wait for that redirect URL and whatever error stops it from arriving.
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
  trialAvailable,
  trialDeniedReason,
}: {
  copy: PlanPurchaseFlowCopy
  token: string
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
      const { initPoint } = await startCheckout(token, payerEmailLocked ? undefined : chosen)
      window.location.href = initPoint
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_payer_email') {
        setIsEditingEmail(true)
        setEmailError(copy.payerEmailInvalid)
      } else {
        setError(caught instanceof Error ? caught.message : copy.genericError)
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

      {trialAvailable ? <p className="plan-card-trial">{copy.planTrialNote}</p> : null}

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
            disabled={isRedirecting}
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

          <button type="button" className="primary-button plan-card-cta" onClick={handleBuy} disabled={isRedirecting}>
            {isRedirecting ? copy.redirecting : trialAvailable ? copy.buyTrialCta : copy.buyCta}
          </button>
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}
