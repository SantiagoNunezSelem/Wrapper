import type { SubscriptionPhase, SubscriptionRecord } from '../types'

/**
 * The server's phase for a subscription (see `SubscriptionPhase`), or — against a backend
 * that does not send it yet — the same split worked out from the fields it always sent.
 * The frontend and the API deploy on their own, and the account screen must not go blank,
 * or stop refreshing itself, in between.
 */
export function phaseOf(current: SubscriptionRecord): SubscriptionPhase {
  if (current.phase) {
    return current.phase
  }

  switch (current.status) {
    case 'pendiente':
      if (current.paymentInProgress) return 'processing'
      if (current.pendingReasonKind === 'declined') return 'declined'
      return current.checkoutUrl ? 'checkout_open' : 'abandoned'
    case 'cancelada':
      return current.hasAccess ? 'cancelled' : 'ended'
    case 'trial':
    case 'activa':
    case 'pago_fallido':
    case 'pausada':
      return current.status
    default:
      return 'abandoned'
  }
}
