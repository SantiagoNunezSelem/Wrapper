import type { ChatMessage } from '../types'
import {
  aiMetricIds,
  matchAiKeywordExplicit,
  matchAiKeywordGeneral,
  matchAiKeywordModerate,
  normalizeForMatch,
  type AiMetricId,
} from './metrics'

// ---------------------------------------------------------------------------
// Turning keyword hits into the smallest prompt that can still be judged well.
//
// The dictionaries in metrics.ts are broad on purpose, so a hit is only a
// *candidate*. What gets sent for each one is a few lines around it — never the
// chat, never a whole conversation, never a name. Every constant below exists to
// keep that payload small, because tokens are the running cost of this feature.
// ---------------------------------------------------------------------------

/** Past this length the flagged message explains itself; neighbours would only cost tokens. */
const SELF_SUFFICIENT_WORDS = 20

/**
 * Redflags reads higher: whether a jab is real "directed conflict" or a joke often
 * hinges on what it's replying to, more than tonopicante's tone-only call does — so
 * this metric gets a wider self-sufficiency bar before it decides a hit doesn't need
 * its neighbours. See REDFLAGS_MAX_CANDIDATES below for the token-budget trade this
 * buys back: raising this number alone would have raised the metric's cost.
 */
const REDFLAGS_SELF_SUFFICIENT_WORDS = 50

function selfSufficientWords(metricId: AiMetricId): number {
  return metricId === 'redflags' ? REDFLAGS_SELF_SUFFICIENT_WORDS : SELF_SUFFICIENT_WORDS
}

/** Under this, a three-message window is too thin to judge ("ok" / "hot" / "jaja"). */
const MIN_WINDOW_WORDS = 5

/** Extra messages pulled in — one per side — when the base window is too thin. */
const EXTRA_CONTEXT_PER_SIDE = 1

/**
 * Redflags-specific versions of the two constants above. Short back-and-forth
 * messages ("dejame en paz" / "sos igual que tu papa" / "no me hables asi") are
 * exactly the case this metric most needs more of the exchange for, so the bar for
 * "this window is too thin" is the same 50 words as REDFLAGS_SELF_SUFFICIENT_WORDS
 * (not the everyday-metric's near-empty-message bar of 5), and it's allowed to reach
 * twice as far per side to try to get there.
 */
const REDFLAGS_MIN_WINDOW_WORDS = 50
const REDFLAGS_EXTRA_CONTEXT_PER_SIDE = 2

function minWindowWords(metricId: AiMetricId): number {
  return metricId === 'redflags' ? REDFLAGS_MIN_WINDOW_WORDS : MIN_WINDOW_WORDS
}

function extraContextPerSide(metricId: AiMetricId): number {
  return metricId === 'redflags' ? REDFLAGS_EXTRA_CONTEXT_PER_SIDE : EXTRA_CONTEXT_PER_SIDE
}

/** Hard ceiling on the flagged message, cropped so the keyword always survives the cut. */
const MAX_HIT_WORDS = 50

/** Neighbours are context, not evidence, so they get a tighter budget. */
const MAX_CONTEXT_WORDS = 25

/**
 * Ceiling on how many snippets one chat+metric may ever send. A chat with 85k
 * messages can produce thousands of keyword hits and there is no version of this
 * feature where paying to classify all of them is worth it. Mirrors
 * `GoogleAi:MaxSnippetsPerMetric` on the backend, which enforces the same limit.
 * `buildAiCandidates` fills these slots tier by tier (crude words before mild ones,
 * see `matchAiKeywordExplicit`/`matchAiKeywordModerate`/`matchAiKeywordGeneral` in
 * metrics.ts), so even a chat with more hits than this cap spends the AI budget on
 * the hits most likely to actually matter instead of just the first ones found.
 */
const MAX_CANDIDATES_PER_METRIC = 300

/**
 * Redflags-specific ceiling — a quarter of MAX_CANDIDATES_PER_METRIC, worked out from
 * the two redflags-specific widenings above so this metric's worst-case token spend
 * never grows past its original ceiling (300 candidates × ≤50 words/each = 15,000
 * words), no matter how the real chat is shaped:
 *   - a hit's own text: still ≤MAX_HIT_WORDS (50) either way.
 *   - context: up to REDFLAGS_EXTRA_CONTEXT_PER_SIDE (2) + the base 1 reach = 3
 *     neighbours per side when REDFLAGS_MIN_WINDOW_WORDS isn't met, i.e. up to 6
 *     context lines, ≤MAX_CONTEXT_WORDS (25) each = ≤150 words.
 *   - worst case per snippet: 50 + 150 = 200 words — 4× the original ≤50-word
 *     ceiling a bare hit used to cost. Quartering the candidate count (300 → 75)
 *     keeps 75 × 200 = 15,000, the same ceiling as before any of this.
 */
const REDFLAGS_MAX_CANDIDATES = 75

function maxCandidates(metricId: AiMetricId): number {
  return metricId === 'redflags' ? REDFLAGS_MAX_CANDIDATES : MAX_CANDIDATES_PER_METRIC
}

export interface AiCandidate {
  /** Short id sent to the model — a plain counter, because ids are billed too. */
  id: string
  /** Every parsed message this one verdict applies to (identical snippets are sent once). */
  messageIds: string[]
  /** The dictionary phrase that flagged it. */
  keyword: string
  /** The rendered snippet: one message per line, speakers anonymised. */
  text: string
}

export interface AiCandidateSet {
  metricId: AiMetricId
  candidates: AiCandidate[]
}

/** Builds the candidate set for every AI-backed metric in one pass per metric. */
export function buildAllAiCandidates(messages: ChatMessage[]): AiCandidateSet[] {
  return aiMetricIds.map((metricId) => ({
    metricId,
    candidates: buildAiCandidates(messages, metricId),
  }))
}

export function buildAiCandidates(messages: ChatMessage[], metricId: AiMetricId): AiCandidate[] {
  // Same pool the metrics themselves read: real authored text only, so neighbours are
  // actual replies and not "<Media omitted>" placeholders.
  const pool = messages.filter((message) => !message.isSystem && message.sender && !message.isSystemPlaceholder)

  const candidates: AiCandidate[] = []
  const byRendering = new Map<string, AiCandidate>()
  const usedIndices = new Set<number>()

  // Strongest tier first — the words most tightly tied to the metric (and, for
  // tonopicante, the crudest ones — a lone "teta" is worth more of the AI budget than a
  // lone "pecho") are the best use of the limited AI slots. Only widen to the next tier
  // once the previous one didn't fill the batch on its own, so a chat that's light on
  // the strongest phrasing still gets a full batch of candidates for the AI to judge
  // (see metrics.ts's matchAiKeywordExplicit/matchAiKeywordModerate/matchAiKeywordGeneral
  // for the tiered dictionaries — redflags has no moderate tier, so that pass is a no-op
  // for it).
  const cap = maxCandidates(metricId)
  collectCandidates(pool, metricId, matchAiKeywordExplicit, candidates, byRendering, usedIndices)
  if (candidates.length < cap) {
    collectCandidates(pool, metricId, matchAiKeywordModerate, candidates, byRendering, usedIndices)
  }
  if (candidates.length < cap) {
    collectCandidates(pool, metricId, matchAiKeywordGeneral, candidates, byRendering, usedIndices)
  }

  return candidates
}

function collectCandidates(
  pool: ChatMessage[],
  metricId: AiMetricId,
  matchKeyword: (metricId: AiMetricId, text: string) => string | null,
  candidates: AiCandidate[],
  byRendering: Map<string, AiCandidate>,
  usedIndices: Set<number>,
): void {
  const cap = maxCandidates(metricId)

  for (let index = 0; index < pool.length && candidates.length < cap; index += 1) {
    if (usedIndices.has(index)) {
      continue
    }

    const message = pool[index]
    const keyword = matchKeyword(metricId, message.contentText)

    if (!keyword) {
      continue
    }

    usedIndices.add(index)
    const text = renderSnippet(pool, index, keyword, metricId)
    const dedupeKey = `${keyword}\n${text}`
    const existing = byRendering.get(dedupeKey)

    // A repeated exchange renders identically. One verdict covers every message it
    // stood for, so the repeat is free instead of being classified again.
    if (existing) {
      existing.messageIds.push(message.id)
      continue
    }

    const candidate: AiCandidate = {
      id: String(candidates.length + 1),
      messageIds: [message.id],
      keyword,
      text,
    }

    candidates.push(candidate)
    byRendering.set(dedupeKey, candidate)
  }
}

/**
 * Expands the model's short candidate ids back into the parsed-message ids they stood
 * for, ready to hand to `applyAiVerdicts`. Works for any list of candidate ids — the
 * accepted ones, the explicitly rejected ones, or anything else the backend hands back.
 */
export function toMessageIds(candidates: AiCandidate[], candidateIds: string[]): Set<string> {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const messageIds = new Set<string>()

  for (const id of candidateIds) {
    for (const messageId of byId.get(id)?.messageIds ?? []) {
      messageIds.add(messageId)
    }
  }

  return messageIds
}

/**
 * One candidate, rendered. Lines are prefixed with a letter standing in for the
 * speaker — enough for the model to follow who answered whom, while the real names
 * never leave the browser. The line to classify is the one marked with `*`.
 *
 *     A: y al final que comiste
 *     *B: la comida estaba re caliente
 *     A: jaja
 */
function renderSnippet(pool: ChatMessage[], index: number, keyword: string, metricId: AiMetricId): string {
  const hit = pool[index]
  const lines: ChatMessage[] = []

  if (countWords(hit.contentText) > selfSufficientWords(metricId)) {
    lines.push(hit)
  } else {
    let reach = 1

    // Three short messages can still add up to nothing ("ok" / "hot" / "jaja") —
    // widen by one message per side before giving the model something unjudgeable.
    // Redflags widens further and more often (see REDFLAGS_MIN_WINDOW_WORDS): a short
    // exchange still under 50 words even with a neighbour on each side needs more of
    // it to tell a real pattern from a one-off joke.
    if (windowWordCount(pool, index, reach) < minWindowWords(metricId)) {
      reach += extraContextPerSide(metricId)
    }

    for (let cursor = Math.max(0, index - reach); cursor < index; cursor += 1) {
      lines.push(pool[cursor])
    }

    lines.push(hit)

    for (let cursor = index + 1; cursor <= Math.min(pool.length - 1, index + reach); cursor += 1) {
      lines.push(pool[cursor])
    }
  }

  const labels = new Map<string, string>()

  return lines
    .map((line) => {
      const isHit = line.id === hit.id
      const text = isHit
        ? clampAroundKeyword(line.contentText, keyword, MAX_HIT_WORDS)
        : clampWords(line.contentText, MAX_CONTEXT_WORDS)

      return `${isHit ? '*' : ''}${speakerLabel(labels, line.sender ?? '?')}: ${text}`
    })
    .join('\n')
}

/** A, B, C… assigned in order of appearance and scoped to a single snippet, so the
 * label carries turn-taking without carrying identity. */
function speakerLabel(labels: Map<string, string>, sender: string): string {
  const existing = labels.get(sender)

  if (existing) {
    return existing
  }

  const label = String.fromCharCode(65 + labels.size)
  labels.set(sender, label)
  return label
}

function windowWordCount(pool: ChatMessage[], index: number, reach: number): number {
  let total = 0

  for (
    let cursor = Math.max(0, index - reach);
    cursor <= Math.min(pool.length - 1, index + reach);
    cursor += 1
  ) {
    total += countWords(pool[cursor].contentText)
  }

  return total
}

/**
 * Crops a long message to `maxWords` around the keyword. Cutting from the start would
 * routinely drop the very word the model is being asked about, so the window is
 * centred on it and then nudged back inside the message's bounds.
 */
function clampAroundKeyword(text: string, keyword: string, maxWords: number): string {
  const parts = splitWords(text)

  if (parts.length <= maxWords) {
    return parts.join(' ')
  }

  const anchor = keywordWordIndex(parts, keyword)
  const start = Math.min(
    Math.max(0, anchor - Math.floor(maxWords / 2)),
    Math.max(0, parts.length - maxWords),
  )
  const end = Math.min(parts.length, start + maxWords)

  return `${start > 0 ? '… ' : ''}${parts.slice(start, end).join(' ')}${end < parts.length ? ' …' : ''}`
}

function clampWords(text: string, maxWords: number): string {
  const parts = splitWords(text)
  return parts.length <= maxWords ? parts.join(' ') : `${parts.slice(0, maxWords).join(' ')} …`
}

/** Where the flagged phrase sits, in word positions. Handles multi-word dictionary
 * entries ("me dejaste en visto") as well as single words. */
function keywordWordIndex(parts: string[], keyword: string): number {
  const needle = normalizeForMatch(keyword).split(/\s+/).filter(Boolean)

  if (needle.length === 0) {
    return 0
  }

  const haystack = parts.map((part) => normalizeForMatch(part).replace(/[^\p{L}\p{N}']/gu, ''))

  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((part, offset) => haystack[index + offset] === part)) {
      return index
    }
  }

  // The dictionary matched against the whole normalized string, so a phrase can
  // straddle punctuation that splitting on whitespace kept glued on. Settle for the
  // first word that contains the phrase's opening token.
  const loose = haystack.findIndex((part) => part.includes(needle[0]))
  return loose >= 0 ? loose : 0
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

function countWords(text: string): number {
  return splitWords(text).length
}
