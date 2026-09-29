/**
 * Mercado Pago's `status_detail`, told as a reason and what to do about it.
 *
 * The codes come from Mercado Pago's own tables ("Resultados de creación de un pago" and
 * "Consulta sobre el estado de un pago"). Each rejection is grouped the way those tables
 * already suggest a fix — check what was typed, talk to the bank, use another card, or
 * try again later — so the screen can say the next step and not only the reason.
 */

import { ApiError } from './api'

export type ReasonAction = 'check_details' | 'call_bank' | 'other_method' | 'retry_later'

/** The server's PaymentOutcomes: what became of the charge. */
export type PaymentOutcome = 'in_progress' | 'declined' | 'cancelled' | 'refunded' | 'disputed'

export interface PaymentReasonCopy {
  pendingReasons: Record<string, string>
  pendingReasonFallback: string
  /** One line per group of rejections: the next step. */
  reasonActions: Record<ReasonAction, string>
  /** Refunds and disputes are told as what happened, not per code: their details
   * ("in_process", "pending") also mean other things for other statuses. */
  refundedReason: string
  disputedReason: string
  anyCard: string
}

const actionByDetail: Record<string, ReasonAction> = {
  cc_rejected_bad_filled_card_number: 'check_details',
  cc_rejected_bad_filled_date: 'check_details',
  cc_rejected_bad_filled_security_code: 'check_details',
  cc_rejected_bad_filled_other: 'check_details',
  rejected_insufficient_data: 'check_details',

  cc_rejected_call_for_authorize: 'call_bank',
  cc_rejected_card_disabled: 'call_bank',
  cc_rejected_other_reason: 'call_bank',
  rejected_by_bank: 'call_bank',
  bank_error: 'call_bank',

  cc_rejected_insufficient_amount: 'other_method',
  insufficient_amount: 'other_method',
  cc_amount_rate_limit_exceeded: 'other_method',
  cc_rejected_high_risk: 'other_method',
  rejected_high_risk: 'other_method',
  cc_rejected_blacklist: 'other_method',
  cc_rejected_max_attempts: 'other_method',
  cc_rejected_duplicated_payment: 'other_method',
  cc_rejected_card_type_not_allowed: 'other_method',
  cc_rejected_invalid_installments: 'other_method',
  cc_rejected_card_error: 'other_method',
  rejected_by_regulations: 'other_method',
  rejected_by_biz_rule: 'other_method',
  rejected_other_reason: 'other_method',

  cc_rejected_time_out: 'retry_later',
  cc_rejected_3ds_challenge: 'retry_later',
  cc_rejected_3ds_mandatory: 'retry_later',
}

/**
 * Why a checkout did not open, in the screen's words. The server answers with a code
 * (see SubscriptionEndpoints.DescribeCheckoutFailure); its own `message` is Spanish-only,
 * and for some conflicts plain English, so neither is shown as it comes.
 */
export function checkoutErrorMessage(errors: Record<string, string>, fallback: string, caught: unknown): string {
  if (caught instanceof ApiError && caught.code && errors[caught.code]) {
    return errors[caught.code]
  }
  return fallback
}

/**
 * @param amount already formatted ("$ 4.990"); filled into reasons that name it.
 * @param card the stored card label ("visa ···· 6411"); "tu tarjeta" when unknown.
 * @returns the reason, and the next step when there is one to take.
 */
export function describePaymentReason(
  copy: PaymentReasonCopy,
  detail: string,
  outcome: PaymentOutcome | null,
  values: { amount: string; card: string | null },
): { reason: string; action: string | null } {
  if (outcome === 'refunded') {
    return { reason: copy.refundedReason, action: null }
  }
  if (outcome === 'disputed') {
    return { reason: copy.disputedReason, action: null }
  }

  const reason = (copy.pendingReasons[detail] ?? copy.pendingReasonFallback)
    .replace('{amount}', values.amount)
    .replace('{card}', values.card ?? copy.anyCard)

  // Only a charge that was refused has a next step; one still moving just needs time.
  const group = outcome === 'declined' ? actionByDetail[detail] : undefined
  return { reason, action: group ? copy.reasonActions[group] : null }
}
