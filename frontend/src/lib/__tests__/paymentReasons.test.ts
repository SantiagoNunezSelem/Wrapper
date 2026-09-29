import { describe, expect, it } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import { describePaymentReason } from '../paymentReasons'

/**
 * Los `status_detail` que Mercado Pago documenta para un pago ("Resultados de creación de
 * un pago" y "Consulta sobre el estado de un pago"). Quedan afuera los de devoluciones y
 * contracargos (`refunded`, `by_admin`, `settled`, `reimbursed`, `in_process`, `pending`):
 * se cuentan por lo que pasó, no por código, porque algunos significan otra cosa con otro
 * status.
 */
const documented = [
  'accredited', 'partially_refunded', 'pending_capture', 'offline_process', 'pending_contingency',
  'pending_review_manual', 'deferred_retry', 'pending_waiting_transfer', 'pending_waiting_payment',
  'pending_challenge', 'expired', 'by_collector', 'by_payer', 'bank_error', 'cc_rejected_3ds_challenge',
  'cc_rejected_3ds_mandatory', 'cc_rejected_bad_filled_card_number', 'cc_rejected_bad_filled_date',
  'cc_rejected_bad_filled_other', 'cc_rejected_bad_filled_security_code', 'cc_rejected_blacklist',
  'cc_rejected_call_for_authorize', 'cc_rejected_card_disabled', 'cc_rejected_card_error',
  'cc_rejected_duplicated_payment', 'cc_rejected_high_risk', 'cc_rejected_insufficient_amount',
  'cc_rejected_invalid_installments', 'cc_rejected_max_attempts', 'cc_rejected_other_reason',
  'cc_rejected_time_out', 'cc_amount_rate_limit_exceeded', 'rejected_insufficient_data', 'rejected_by_bank',
  'rejected_by_regulations', 'rejected_high_risk', 'rejected_by_biz_rule', 'rejected_other_reason',
  'insufficient_amount', 'cc_rejected_card_type_not_allowed',
]

const values = { amount: '$ 4.990', card: 'visa ···· 6411' }

describe('paymentReasons', () => {
  it.each(['es', 'en'] as const)('cada código documentado tiene su texto en %s', (language) => {
    const missing = documented.filter((code) => !shellCopy[language].subscriptionPage.pendingReasons[code])
    expect(missing).toEqual([])
  })

  it('todo rechazo documentado dice qué hacer', () => {
    const copy = shellCopy.es.subscriptionPage
    const rejected = documented.filter((code) => /rejected|bank_error|insufficient_amount|rate_limit/.test(code))
    const withoutAction = rejected.filter(
      (code) => describePaymentReason(copy, code, 'declined', values).action === null,
    )
    expect(withoutAction).toEqual([])
  })

  it('completa la tarjeta y el monto, y sin tarjeta dice "tu tarjeta"', () => {
    const copy = shellCopy.es.subscriptionPage

    expect(describePaymentReason(copy, 'cc_rejected_call_for_authorize', 'declined', values).reason).toBe(
      'Tu banco tiene que autorizar el cobro de $ 4.990 con visa ···· 6411.',
    )
    expect(describePaymentReason(copy, 'cc_amount_rate_limit_exceeded', 'declined', { ...values, card: null }).reason).toBe(
      'El cobro supera el límite de tu tarjeta.',
    )
  })
})
