import type { SubscriptionOverview, UserProfile } from '../types'

/**
 * The address a new checkout would be opened for, before anyone changes it: the forced
 * test payer, then the one an unfinished checkout already used (so a retry offers the
 * same account back), then the Google login — which is what most people also use for
 * Mercado Pago.
 */
export function defaultPayerEmail(user: UserProfile, overview: SubscriptionOverview | null): string {
  const current = overview?.current
  return (
    user.checkoutTestPayerEmail ??
    (current?.status === 'pendiente' ? current.payerEmail : null) ??
    user.email
  )
}

/** Only "does this look like an address" — which accounts exist is Mercado Pago's to say. */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
