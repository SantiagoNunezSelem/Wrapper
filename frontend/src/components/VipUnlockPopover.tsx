import { formatMoney } from '../lib/format'
import { ModalShell } from './ModalShell'
import { PlanPurchaseFlow, type PlanPurchaseFlowCopy } from './PlanPurchaseFlow'
import type { Language, SubscriptionOverview, SubscriptionPlan, UserProfile } from '../types'

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
 *
 * Buying redirects to Mercado Pago's own hosted checkout (see PlanPurchaseFlow), so this
 * popover never needs to widen for a card step or show its own success state — the
 * browser navigates away before either would matter.
 */
export function VipUnlockPopover({
  copy,
  language,
  user,
  token,
  plan,
  overview,
  onClose,
  onSignIn,
}: {
  copy: VipUnlockPopoverCopy
  /** El precio se formatea con el idioma de la interfaz. Antes estaba clavado en
   * `es-AR` acá adentro, así que un usuario en inglés veía el importe con el
   * formato argentino mientras el resto de la pantalla iba en el suyo. */
  language: Language
  user: UserProfile | null
  token: string | null
  plan: SubscriptionPlan | null
  overview: SubscriptionOverview | null
  onClose: () => void
  onSignIn: () => void
}) {
  return (
    <ModalShell onDismiss={onClose} label={copy.title} className="vip-popover" closeLabel={copy.close}>
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2>{copy.title}</h2>

        <div className="vip-popover-plan-head">
          <span className="plan-card-name">{copy.planName}</span>
          <span className="plan-card-price">
            {plan ? formatMoney(plan.amount, plan.currencyId, language === 'es' ? 'es-AR' : 'en-US') : '—'}
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
          />
        )}
    </ModalShell>
  )
}
