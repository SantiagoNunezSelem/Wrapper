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
