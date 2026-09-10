/** Las tres secciones del panel. El orden es el del menú. */
export type AdminSection = 'negocio' | 'urgencias' | 'usuarios'

export interface AdminLatestSubscription {
  userId: string
  email: string
  status: string
  amount: number
  currencyId: string
  createdAtUtc: string
}

export interface AdminBusiness {
  days: number
  registeredUsers: number
  newUsers: number
  newUsersPrevious: number
  proActive: number
  inTrial: number
  newPro: number
  monthlyRecurringRevenue: number
  /** Null cuando no terminó ningún trial en el período: "0%" diría que fracasaron todos. */
  trialConversion: number | null
  trialConversionPrevious: number | null
  /** Un valor por día, del más viejo al de hoy, cortado en hora argentina. */
  signupsByDay: number[]
  /** Seis meses, del más viejo al actual, como `yyyy-MM`. */
  collectedByMonth: { month: string; amount: number }[]
  latestSubscriptions: AdminLatestSubscription[]
}

export type UrgencySeverity = 'critical' | 'warning' | 'info'

export type UrgencyKind =
  | 'orphan_payment'
  | 'webhook_rejected'
  | 'payment_pending'
  | 'payment_failed'
  | 'trial_blocked'
  | 'ai_failing'

/** `reference` y `detail` significan cosas distintas según `kind`; la pantalla redacta cada tipo. */
export interface AdminUrgency {
  kind: UrgencyKind
  severity: UrgencySeverity
  atUtc: string
  count: number
  userId: string | null
  userEmail: string | null
  reference: string | null
  detail: string | null
  deadlineUtc: string | null
}

export interface AdminPaymentsHealth {
  instanceStartedAtUtc: string
  notificationsReceived: number
  notificationsAccepted: number
  notificationsRejected: number
  lastAcceptedAtUtc: string | null
  reconcileIntervalMinutes: number
  webhookSecretConfigured: boolean
  usingTestCredentials: boolean
  testPayerEmail: string | null
}

export interface AdminUrgencies {
  items: AdminUrgency[]
  health: AdminPaymentsHealth
}

export interface AdminUserRow {
  id: string
  email: string
  displayName: string
  createdAtUtc: string
  state: string
  isAdmin: boolean
}

export interface AdminUserPage {
  total: number
  page: number
  pageSize: number
  items: AdminUserRow[]
}

export interface AdminSubscription {
  id: string
  status: string
  planType: string
  amount: number
  currencyId: string
  paymentMethodLabel: string | null
  externalSubscriptionId: string | null
  lastPaymentStatusDetail: string | null
  trialEndsAtUtc: string | null
  nextBillingAtUtc: string | null
  graceEndsAtUtc: string | null
  cancelledAtUtc: string | null
  lastSyncedAtUtc: string | null
  createdAtUtc: string
  isSeededVip: boolean
  isDevSimulated: boolean
}

export interface AdminInvoice {
  id: string
  status: string
  statusDetail: string | null
  amount: number
  currencyId: string
  paidAtUtc: string | null
  debitScheduledAtUtc: string | null
  createdAtUtc: string
  attemptNumber: number
}

export interface AdminEvent {
  id: string
  topic: string
  action: string | null
  resultingStatus: string | null
  notes: string | null
  createdAtUtc: string
}

export interface AdminUsage {
  savedAnalyses: number
  sharedStories: number
  aiMetrics: number
  aiMetricsFailed: number
  freeUnlocks: number
  trialClaims: number
  trialCountries: string[]
}

export interface AdminUserDetail {
  id: string
  email: string
  displayName: string
  preferredLanguage: string
  createdAtUtc: string
  isAdmin: boolean
  hasUsedTrial: boolean
  aiConsentAtUtc: string | null
  state: string
  hasProAccess: boolean
  current: AdminSubscription | null
  subscriptions: AdminSubscription[]
  invoices: AdminInvoice[]
  events: AdminEvent[]
  usage: AdminUsage
}
