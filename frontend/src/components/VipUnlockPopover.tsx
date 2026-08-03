import { useState } from 'react'
import { CrossButton } from './IconButton'
import { PlanPurchaseFlow, type PlanPurchaseFlowCopy } from './PlanPurchaseFlow'
import type { SubscriptionOverview, SubscriptionPlan, UserProfile } from '../types'

export interface VipUnlockPopoverCopy extends PlanPurchaseFlowCopy {
  eyebrow: string
  title: string
  close: string
  signInPrompt: string
  signInCta: string
}

/**
 * What "Desbloquear VIP" opens on a locked metric card: the plan, right there, no
 * navigation. Deliberately flat — unlike the plan card on the full `/suscripcion`
 * account page, there is nothing to expand here, since showing the plan *is* the whole
 * point of having clicked through in the first place.
 */
export function VipUnlockPopover({
  copy,
  user,
  token,
  plan,
  overview,
  onClose,
  onSignIn,
  onSuccess,
}: {
  copy: VipUnlockPopoverCopy
  user: UserProfile | null
  token: string | null
  plan: SubscriptionPlan | null
  overview: SubscriptionOverview | null
  onClose: () => void
  onSignIn: () => void
  onSuccess: (overview: SubscriptionOverview) => void
}) {
  // The card step needs more room for the Payment Brick's fields than the plan step's
  // details/benefits list does — Santiago wants the popover wider only there, not on
  // the plan step he already likes as-is.
  const [flowStep, setFlowStep] = useState<'plan' | 'card' | 'success'>('plan')

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className={`modal-card vip-popover ${flowStep === 'card' ? 'vip-popover-wide' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <CrossButton label={copy.close} onClick={onClose} className="close-button" />

        <p className="eyebrow">{copy.eyebrow}</p>
        <h2>{copy.title}</h2>

        <div className="vip-popover-plan-head">
          <span className="plan-card-name">{copy.planName}</span>
          <span className="plan-card-price">
            {plan ? formatMoney(plan.amount, plan.currencyId, 'es-AR') : '—'}
            <small> {copy.perMonth}</small>
          </span>
        </div>

        {!user || !token ? (
          <div className="vip-popover-signin">
            <p className="panel-copy">{copy.signInPrompt}</p>
            <button type="button" className="primary-button" onClick={onSignIn}>
              {copy.signInCta}
            </button>
          </div>
        ) : (
          <PlanPurchaseFlow
            copy={copy}
            token={token}
            userEmail={user.email}
            plan={plan}
            trialAvailable={Boolean(overview?.trialAvailable)}
            trialDeniedReason={overview?.trialDeniedReason ?? null}
            onSuccess={onSuccess}
            onDone={onClose}
            onStepChange={setFlowStep}
          />
        )}
      </section>
    </div>
  )
}

function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}
