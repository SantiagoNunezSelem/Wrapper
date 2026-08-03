import { useState } from 'react'
import { CardCheckoutBrick, type CardCheckoutBrickCopy } from './CardCheckoutBrick'
import { createSubscriptionWithCard } from '../lib/api'
import type { SubscriptionOverview, SubscriptionPlan } from '../types'

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
  cardStepTitle: string
  cardStepBack: string
  cardCheckout: CardCheckoutBrickCopy
  submitting: string
  genericError: string
  successTitle: string
  successTrialBody: string
  successActiveBody: string
  successCta: string
}

/**
 * The whole "buy" experience in one reusable piece: plan details, then the Card Payment
 * Brick, then a confirmation — all inline, no navigation. Used both by the full
 * `/suscripcion` page (inside its collapsible plan card) and by the quick popover a
 * locked metric's "Desbloquear VIP" opens; the two differ only in how they wrap it, not
 * in what it does.
 */
export function PlanPurchaseFlow({
  copy,
  token,
  userEmail,
  plan,
  trialAvailable,
  trialDeniedReason,
  onSuccess,
  onDone,
}: {
  copy: PlanPurchaseFlowCopy
  token: string
  userEmail: string
  plan: SubscriptionPlan | null
  trialAvailable: boolean
  trialDeniedReason: string | null
  onSuccess: (overview: SubscriptionOverview) => void
  onDone?: () => void
}) {
  const [step, setStep] = useState<'plan' | 'card' | 'success'>('plan')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<SubscriptionOverview | null>(null)

  async function handleToken(cardTokenId: string) {
    setIsSubmitting(true)
    setError('')

    try {
      const overview = await createSubscriptionWithCard(token, cardTokenId)
      setResult(overview)
      setStep('success')
      onSuccess(overview)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.genericError)
      // Rethrown so the Brick's own onSubmit promise rejects — that is what tells it
      // the attempt failed and the card form should stay up for another try, instead
      // of showing its own "submitted" state for a charge that never went through.
      throw caught
    } finally {
      setIsSubmitting(false)
    }
  }

  if (step === 'success') {
    const isTrial = result?.current?.status === 'trial'

    return (
      <div className="plan-flow-success">
        <span className="plan-flow-success-icon" aria-hidden="true">
          <CheckIcon />
        </span>
        <h3>{copy.successTitle}</h3>
        <p>{isTrial ? copy.successTrialBody : copy.successActiveBody}</p>
        {onDone ? (
          <button type="button" className="primary-button" onClick={onDone}>
            {copy.successCta}
          </button>
        ) : null}
      </div>
    )
  }

  if (step === 'card') {
    return (
      <div className="plan-flow-card">
        <button
          type="button"
          className="plan-flow-back"
          onClick={() => {
            setStep('plan')
            setError('')
          }}
          disabled={isSubmitting}
        >
          <BackIcon /> {copy.cardStepBack}
        </button>

        <h3>{copy.cardStepTitle}</h3>

        {plan ? (
          <CardCheckoutBrick
            copy={copy.cardCheckout}
            amount={plan.amount}
            payerEmail={userEmail}
            onSubmit={handleToken}
            onError={setError}
          />
        ) : null}

        {isSubmitting ? <p className="plan-flow-submitting">{copy.submitting}</p> : null}
        {error ? <p className="plan-flow-error">{error}</p> : null}
      </div>
    )
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
        <button type="button" className="primary-button plan-card-cta" onClick={() => setStep('card')}>
          {trialAvailable ? copy.buyTrialCta : copy.buyCta}
        </button>
      ) : (
        <p className="plan-card-hint">{copy.paymentsDisabled}</p>
      )}

      {!trialAvailable && trialDeniedReason ? (
        <p className="plan-card-hint">
          {copy.trialUnavailable} {copy.trialReasons[trialDeniedReason] ?? ''}
        </p>
      ) : null}
    </div>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}
