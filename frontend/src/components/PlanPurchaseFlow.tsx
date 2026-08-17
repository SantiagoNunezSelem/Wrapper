import { useState } from 'react'
import { startCheckout } from '../lib/api'
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
 */
export function PlanPurchaseFlow({
  copy,
  token,
  plan,
  trialAvailable,
  trialDeniedReason,
}: {
  copy: PlanPurchaseFlowCopy
  token: string
  userEmail: string
  plan: SubscriptionPlan | null
  trialAvailable: boolean
  trialDeniedReason: string | null
}) {
  const [error, setError] = useState('')
  const [isRedirecting, setIsRedirecting] = useState(false)

  async function handleBuy() {
    setIsRedirecting(true)
    setError('')

    try {
      const { initPoint } = await startCheckout(token)
      window.location.href = initPoint
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.genericError)
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
        <button type="button" className="primary-button plan-card-cta" onClick={handleBuy} disabled={isRedirecting}>
          {isRedirecting ? copy.redirecting : trialAvailable ? copy.buyTrialCta : copy.buyCta}
        </button>
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}
