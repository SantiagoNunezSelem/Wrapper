export type Language = 'es' | 'en'

export interface UserProfile {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  isAdmin: boolean
  hasUsedTrial: boolean
  hasVipAccess: boolean
  subscriptionState: string
  /** Whether this user agreed to send filtered snippets to the AI. */
  hasAiConsent: boolean
  /** Whether the backend has a Google AI Studio key configured at all. */
  aiEnabled: boolean
  /** Whether the backend has Mercado Pago credentials. Without them the upsell says so
   * instead of opening a checkout that cannot complete. */
  paymentsEnabled: boolean
}

/**
 * Subscription lifecycle, mirroring the backend's Spanish status vocabulary:
 * - `pendiente`: checkout opened, the payer has not authorized it yet.
 * - `trial`: inside the free week; nothing charged.
 * - `activa`: paid and current.
 * - `pago_fallido`: a charge was rejected; access survives the grace window.
 * - `pausada`: debits suspended, card kept.
 * - `cancelada`: no renewal; access lasts until the paid period ends.
 * - `inactiva`: no access.
 */
export type SubscriptionStatus =
  | 'pendiente'
  | 'trial'
  | 'activa'
  | 'pago_fallido'
  | 'pausada'
  | 'cancelada'
  | 'inactiva'

export interface SubscriptionPlan {
  amount: number
  currencyId: string
  frequency: number
  frequencyType: string
  trialFrequency: number
  trialFrequencyType: string
  name: string
  /** Whether Mercado Pago credentials are configured on the server — without them
   * "Comprar" cannot complete, since the Brick has no subscription to create against. */
  providerConfigured: boolean
}

export interface SubscriptionRecord {
  id: string
  status: SubscriptionStatus
  planType: string
  amount: number
  currencyId: string
  paymentProvider: string | null
  paymentMethodLabel: string | null
  externalSubscriptionId: string | null
  trialStartsAtUtc: string | null
  trialEndsAtUtc: string | null
  subscriptionStartsAtUtc: string | null
  nextBillingAtUtc: string | null
  lastPaymentAtUtc: string | null
  cancelledAtUtc: string | null
  graceEndsAtUtc: string | null
  trialWasApplied: boolean
  isDevSimulated: boolean
  hasAccess: boolean
  createdAtUtc: string
}

export interface SubscriptionInvoice {
  id: string
  amount: number
  currencyId: string
  /** `aprobado` | `rechazado` | `pendiente` | `reintentando` | `devuelto` */
  status: string
  paymentMethodLabel: string | null
  periodStartUtc: string | null
  periodEndUtc: string | null
  paidAtUtc: string | null
  debitScheduledAtUtc: string | null
  attemptNumber: number
  createdAtUtc: string
}

export interface SubscriptionEvent {
  id: string
  topic: string
  action: string | null
  resultingStatus: string | null
  notes: string | null
  createdAtUtc: string
}

export interface SubscriptionOverview {
  plan: SubscriptionPlan
  current: SubscriptionRecord | null
  hasVipAccess: boolean
  isAdmin: boolean
  /** Access granted by the admin override rather than by a purchase — nothing to cancel. */
  accessFromAdminOverride: boolean
  trialAvailable: boolean
  /** `account_used` | `ip_used` | `network_used` | `device_used` | `country_not_allowed` */
  trialDeniedReason: string | null
  history: SubscriptionRecord[]
  invoices: SubscriptionInvoice[]
  events: SubscriptionEvent[]
  warning: string | null
}

/**
 * Why an AI-backed metric is (or isn't) showing data.
 * - `ready`: the model answered and the card holds verified numbers.
 * - `failed`: the call failed — show "Analizar de nuevo" plus the countdown.
 * - `pending`: no verdict yet (still running, or the viewer isn't Pro).
 * - `consent`: Pro, but hasn't authorized sending snippets yet.
 * - `unavailable`: this deployment has no AI key configured.
 */
export type AiMetricStatus = 'ready' | 'failed' | 'pending' | 'consent' | 'unavailable'

export interface AiCardState {
  status: AiMetricStatus
  errorCode?: string | null
  /** Server timestamp. The retry button stays disabled until this moment passes. */
  retryAvailableAtUtc?: string | null
}

/** One metric's stored verdict, exactly as the backend returns it. */
export interface AiMetricState {
  metricId: string
  status: 'ready' | 'failed'
  acceptedIds: string[]
  errorCode: string | null
  retryAvailableAtUtc: string | null
  updatedAtUtc: string
}

export interface AuthResponse {
  token: string
  user: UserProfile
}

export interface SavedAnalysis {
  id: string
  chatName: string
  dateRangeLabel: string
  messageCount: number
  participantCount: number
  resultsJson: string
  sourceHash: string
  createdAtUtc: string
  updatedAtUtc: string
}

export interface ChatMessage {
  id: string
  timestamp: string
  sender: string | null
  /** Raw text as exported by WhatsApp — kept for literal-quote display. */
  message: string
  /** `message` with WhatsApp's own `<...>` markers stripped out. This is what every
   * text/word-based stat must read from, so placeholders never pollute word counts. */
  contentText: string
  isSystem: boolean
  /** Matches a media-omitted marker (any language/bracket variant). */
  isMedia: boolean
  isDeleted: boolean
  /** True when the whole message was a WhatsApp auto-marker with no authored text
   * left after stripping (e.g. "<Media omitted>"). Excluded from every content stat
   * except "El Fan de la Multimedia". */
  isSystemPlaceholder: boolean
  wordCount: number
}

export interface BarDatum {
  label: string
  value: number
  displayValue: string
}

export interface DonutDatum {
  label: string
  value: number
}

export interface RadarDatum {
  axis: string
  value: number
}

export interface TimelinePoint {
  dateLabel: string
  label: string
  value: number
}

export interface WordCloudDatum {
  word: string
  count: number
}

export interface CalendarDay {
  date: string
  count: number
}

export interface StreakRange {
  startLabel: string
  endLabel: string
  days: number
}

export interface MonthDatum {
  monthLabel: string
  count: number
}

export type ChartData =
  | { kind: 'bar'; items: BarDatum[] }
  | { kind: 'donut'; items: DonutDatum[] }
  | { kind: 'hourHeatmap'; hours: number[] }
  | { kind: 'yearHeatmap'; days: CalendarDay[] }
  | { kind: 'monthHeatmap'; months: MonthDatum[] }
  | { kind: 'radar'; axes: RadarDatum[] }
  | { kind: 'calendarStreak'; streaks: StreakRange[] }
  | { kind: 'timeline'; points: TimelinePoint[] }
  | { kind: 'wordCloud'; words: WordCloudDatum[] }
  | { kind: 'histogram'; buckets: BarDatum[] }

/** A single WhatsApp-style bubble inside a message group. `isHighlight` marks the
 * actual moment the metric is about; non-highlighted bubbles are just the message
 * right before/after it, shown for context so the user can recall the exchange. */
export interface ChatBubble {
  sender: string
  text: string
  timestampLabel: string
  isHighlight: boolean
  /** A synthetic "N messages skipped" marker rather than a real message — rendered
   * as a plain divider so a truncated streak never looks like it just ended there. */
  isDivider?: boolean
}

/** A collapsible unit in a metric's detail view: one heading (e.g. "Fran encadenó 9
 * mensajes:") plus the chat bubbles that back it up. */
export interface MessageGroup {
  id: string
  heading: string
  bubbles: ChatBubble[]
}

export interface MetricStat {
  value: string
  label: string
  /** Optional short literal context line shown under the stat (e.g. a quote). */
  note?: string
  chart?: ChartData
}

export interface ParticipantBreakdownEntry {
  name: string
  value: number
  displayValue: string
}

export interface MetricSeriesEntry {
  name: string
  chart: ChartData
}

export interface MetricDetail {
  intro?: string
  chart?: ChartData
  breakdown?: ParticipantBreakdownEntry[]
  /** Per-participant mini charts (e.g. one heatmap/radar/donut per person). */
  series?: MetricSeriesEntry[]
  /** Chat-bubble moments with context (used by metrics that quote real messages). */
  groups?: MessageGroup[]
  /** Heading for `groups`. Falls back to `paginatedItemsLabel` when absent, since most
   * metrics only ever set one of the two lists and historically shared one label. */
  groupsLabel?: string
  /** Plain list, for metrics with no literal messages to quote (e.g. word tallies). */
  paginatedItems?: string[]
  paginatedItemsLabel?: string
}

export interface MetricCard {
  id: string
  title: string
  /** Short, single-sentence, plain-language explanation. Always visible, even locked. */
  description: string
  tier: 'free' | 'vip'
  accent: string
  /** Whether this chat has meaningful data for this metric at all. Cards with no
   * data are omitted entirely by the caller — never rendered, blurred or not. */
  hasData: boolean
  /** Undefined when locked (vip tier card without VIP access) — render the skeleton state. */
  basic?: MetricStat
  /** Undefined when locked (any tier, viewer lacks VIP access) — render the skeleton state. */
  detail?: MetricDetail
  /** Safe teaser copy shown in place of `basic`/`detail` while locked. */
  preview: string
  /** Present only on metrics whose result depends on the AI pass. */
  ai?: AiCardState
}

export interface AnalysisBundle {
  chatName: string
  dateRangeLabel: string
  generatedAt: string
  messageCount: number
  participantCount: number
  participants: string[]
  sourceHash: string
  freeMetrics: MetricCard[]
  vipMetrics: MetricCard[]
}
