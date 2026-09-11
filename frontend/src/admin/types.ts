/** Las secciones del panel. El orden es el del menú. */
export type AdminSection = 'negocio' | 'urgencias' | 'usuarios' | 'cobros' | 'ia' | 'producto' | 'sistema'

/** Las ventanas que se pueden elegir en las secciones que miran un período. */
export const ADMIN_PERIODS = [7, 30, 90] as const
export type AdminPeriod = (typeof ADMIN_PERIODS)[number]

export interface AdminLatestSubscription {
  userId: string
  email: string
  status: string
  amount: number
  currencyId: string
  createdAtUtc: string
}

/** De las cuentas creadas en el período, cuántas llegaron a cada paso. */
export interface AdminFunnel {
  registered: number
  savedAnalysis: number
  openedCheckout: number
  paid: number
}

export interface AdminProMovement {
  /** `yyyy-MM`. */
  month: string
  started: number
  cancelled: number
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
  /** Null hasta que alguna cuenta abra la app con esta versión: antes el ingreso no se registraba. */
  activeUsers7: number | null
  activeUsers30: number | null
  aiInputTokensMonth: number
  aiOutputTokensMonth: number
  /** Null sin precios configurados: el panel no inventa un costo. */
  aiCostMonthUsd: number | null
  funnel: AdminFunnel
  /** Seis meses, del más viejo al actual. */
  proMovements: AdminProMovement[]
}

export type UrgencySeverity = 'critical' | 'warning' | 'info'

export type UrgencyKind =
  | 'orphan_payment'
  | 'webhook_rejected'
  | 'payment_pending'
  | 'payment_failed'
  | 'trial_blocked'
  | 'trial_ending'
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
  /** El nickname de la cuenta que cobra, leído de Mercado Pago. Null si no se pudo consultar. */
  sellerNickname: string | null
  /** Avisos rechazados en las últimas 24 h, leídos de la base: sobreviven a un deploy. */
  rejectedLastDay: number
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
  /** Cuándo un admin le quitó el acceso. Null si nunca. */
  accessRevokedAtUtc: string | null
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
  /** Entrada + salida, de todas sus llamadas registradas. */
  aiTokens: number
}

/** Una nota interna sobre una cuenta. Sólo la ve el panel. */
export interface AdminNote {
  id: string
  authorEmail: string
  text: string
  createdAtUtc: string
}

/**
 * De dónde sale el Pro de la cuenta y qué acciones de acceso ofrece el panel. Lo decide el
 * servidor, así el panel nunca muestra un botón que la API rechazaría.
 */
export interface AdminAccess {
  source: 'admin' | 'subscription' | 'courtesy' | 'none'
  /** Fin del Pro dado desde el panel, mientras dura. */
  courtesyUntilUtc: string | null
  canGrantVip: boolean
  grantVipBlockedReason: 'admin' | 'paid_active' | null
  canRevokeVip: boolean
  /** Si quitar el Pro también cancela una suscripción que Mercado Pago volvería a cobrar. */
  revokeCancelsBilling: boolean
  trialState: 'used' | 'granted' | 'unused'
  trialGrantedAtUtc: string | null
  canGrantTrial: boolean
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
  /** Última vez que abrió la app con la sesión iniciada. Null si no entró desde que se registra. */
  lastSeenAtUtc: string | null
  notes: AdminNote[]
  access: AdminAccess
}

export interface AdminInvoiceRow {
  id: string
  userId: string
  email: string
  status: string
  statusDetail: string | null
  amount: number
  currencyId: string
  paidAtUtc: string | null
  debitScheduledAtUtc: string | null
  createdAtUtc: string
  attemptNumber: number
}

export interface AdminInvoicePage {
  total: number
  page: number
  pageSize: number
  items: AdminInvoiceRow[]
  /** De todos los cobros, sin el filtro: de acá salen los chips de estado. */
  countsByStatus: Record<string, number>
  approvedThisMonth: number
}

export interface AdminCount {
  key: string
  count: number
}

export interface AdminAiMetricUsage {
  metricId: string
  calls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
}

export interface AdminAiReport {
  days: number
  /** False mientras no haya ninguna llamada registrada, en ningún período. */
  tracked: boolean
  model: string
  pricesConfigured: boolean
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  tokensByDay: number[]
  byMetric: AdminAiMetricUsage[]
  errorsByCode: AdminCount[]
}

export interface AdminProductReport {
  days: number
  analysesByDay: number[]
  topUnlocked: AdminCount[]
  topAiMetrics: AdminCount[]
  sharedInPeriod: number
  liveShares: number
  liveShareViews: number
}

export type IntegrationState = 'ok' | 'warn' | 'bad' | 'off'

export interface AdminIntegration {
  key: string
  state: IntegrationState
  value: string | null
}

export interface AdminAuditEntry {
  id: string
  adminEmail: string
  action: string
  targetUserId: string | null
  details: string | null
  createdAtUtc: string
}

export interface AdminSystemReport {
  environment: string
  version: string | null
  startedAtUtc: string
  integrations: AdminIntegration[]
  trialDenials30d: AdminCount[]
  audit: AdminAuditEntry[]
}
