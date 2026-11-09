import type { ChatMessage } from '../types'
import { aiHitProfile, redFlagCategoryByScanCode, type RedFlagCategoryId } from './metrics'
import { buildScrubber, letterFor } from './scrub'

// ---------------------------------------------------------------------------
// The scan: the AI reads the chat itself.
//
// The keyword-hit metrics can only judge what a dictionary pointed at, so a threat nobody listed,
// or a manipulation with no insult in it, is invisible to them. The scan is the complement: two
// stretches of the chat are read in full and the AI names what it finds.
//
//  - The most recent `SCAN_RECENT_MESSAGES` messages, all of them, newest stretch first.
//  - If the chat is longer than that, a few hundred "hot" windows from the older part — the
//    places where the chat itself ran hot (shouting, a long silence on either side, the words the
//    dictionaries know), so what is read from the past is what was most likely to matter.
//
// Nothing here is a name: every participant is a letter, and the letters are also what replaces
// their names inside what is said. A message is a numbered line, and the numbers are all the AI
// answers with; this file keeps which message each number was.
// ---------------------------------------------------------------------------

/** The most recent messages the scan reads, all of them. */
export const SCAN_RECENT_MESSAGES = 5000

/** Lines in one stretch of the recent part: a few thousand tokens, answerable in one call. */
export const SCAN_CHUNK_LINES = 400

/** Lines in one hot window: enough conversation around a spike to tell a fight from a joke. */
export const HOT_WINDOW_LINES = 12

/** Hot windows read from the part of the chat older than the recent one. */
export const HOT_WINDOW_COUNT = 100

/** Lines one request carries. Mirrors `GoogleAi:MaxScanLinesPerPart` on the backend, which enforces the same ceiling. */
export const SCAN_LINES_PER_PART = 2000

/** Words of one line; a longer message is cut, because the scan reads thousands of them. */
export const SCAN_LINE_WORDS = 40

/** Fewer messages than this and there is nothing worth a scan. */
export const MIN_SCAN_MESSAGES = 30

/** The id prefix the backend knows the scan's parts by (`AiMetricPrompts.RedFlagsScanPrefix`). */
export const SCAN_METRIC_PREFIX = 'redflags-scan-'

/** Heat a window has to add up to before it is worth reading. */
const MIN_WINDOW_HEAT = 3

/** A silence this long, in hours, makes the messages on both sides of it hot. */
const LONG_SILENCE_HOURS = 48

export interface ScanChunk {
  id: string
  /** Numbered lines, one per message: "412 B: te dije que no". */
  text: string
}

/** One request's worth of the scan, with the id the backend stores its verdict under. */
export interface ScanPart {
  metricId: string
  chunks: ScanChunk[]
}

export interface ScanPlan {
  parts: ScanPart[]
  /** Which message each numbered line was. Never leaves the browser. */
  lines: Map<number, string>
}

function clampWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean)
  return words.length <= maxWords ? words.join(' ') : `${words.slice(0, maxWords).join(' ')} …`
}

/** How much a message looks like the middle of a fight, from the message alone. */
function heatOf(message: ChatMessage): number {
  const text = message.contentText
  let heat = 0

  const profile = aiHitProfile('redflags', text)
  if (profile) {
    heat += profile.explicit ? 3 : profile.general || profile.moderate ? 2 : 1
  }

  const letters = text.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 8 && text.replace(/[^\p{Lu}]/gu, '').length / letters.length >= 0.6) {
    heat += 2
  }

  if (/[!?]{2,}/.test(text)) {
    heat += 1
  }

  return heat
}

/**
 * The `limit` hottest places of the chat, as windows of `HOT_WINDOW_LINES` messages that do not
 * overlap. A message's heat is its own (see `heatOf`) plus one for each side of a long silence; a
 * window's is the sum of its messages'. Ties go to the newer window, like everything else here.
 */
export function hotWindows(pool: ChatMessage[], limit: number): { start: number; end: number }[] {
  const heat = pool.map(heatOf)

  for (let index = 0; index < pool.length - 1; index += 1) {
    const gapHours = (Date.parse(pool[index + 1].timestamp) - Date.parse(pool[index].timestamp)) / 3_600_000

    if (gapHours >= LONG_SILENCE_HOURS) {
      heat[index] += 1
      heat[index + 1] += 1
    }
  }

  const prefix = [0]
  for (const value of heat) {
    prefix.push(prefix[prefix.length - 1] + value)
  }

  const before = Math.floor((HOT_WINDOW_LINES - 1) / 2)
  const candidates: { start: number; end: number; total: number; center: number }[] = []

  for (let center = 0; center < pool.length; center += 1) {
    if (heat[center] === 0) {
      continue
    }

    const start = Math.max(0, Math.min(center - before, pool.length - HOT_WINDOW_LINES))
    const end = Math.min(pool.length, start + HOT_WINDOW_LINES)
    candidates.push({ start, end, total: prefix[end] - prefix[start], center })
  }

  candidates.sort((left, right) => right.total - left.total || right.center - left.center)

  const taken = new Uint8Array(pool.length)
  const chosen: { start: number; end: number }[] = []

  for (const candidate of candidates) {
    if (chosen.length >= limit || candidate.total < MIN_WINDOW_HEAT) {
      break
    }

    let free = true
    for (let index = candidate.start; index < candidate.end; index += 1) {
      if (taken[index]) {
        free = false
        break
      }
    }

    if (!free) {
      continue
    }

    taken.fill(1, candidate.start, candidate.end)
    chosen.push({ start: candidate.start, end: candidate.end })
  }

  // Newest first, the order they are numbered and sent in.
  return chosen.sort((left, right) => right.start - left.start)
}

/**
 * Everything the scan needs for one chat: the parts to send and the map from line numbers back to
 * messages. Runs in the worker, like the candidates — it walks every message.
 */
export function buildScanPlan(messages: ChatMessage[]): ScanPlan {
  const pool = messages.filter((message) => !message.isSystem && message.sender && !message.isSystemPlaceholder)

  if (pool.length < MIN_SCAN_MESSAGES) {
    return { parts: [], lines: new Map() }
  }

  const people = [...new Set(pool.map((message) => message.sender as string))]
  const letters = new Map(people.map((name, index) => [name, index < 26 ? letterFor(index) : `P${index + 1}`]))
  const scrub = buildScrubber(people, letters)

  const lines = new Map<number, string>()
  let nextLine = 1

  const render = (slice: ChatMessage[]): string =>
    slice
      .map((message) => {
        const number = nextLine
        nextLine += 1
        lines.set(number, message.id)

        const text = clampWords(scrub(message.contentText).replace(/\s+/g, ' ').trim(), SCAN_LINE_WORDS)
        return `${number} ${letters.get(message.sender as string)}: ${text}`
      })
      .join('\n')

  const chunks: ScanChunk[] = []

  // The recent part, newest stretch first; inside a stretch the messages run in chat order, the
  // way a conversation is read.
  const recentStart = Math.max(0, pool.length - SCAN_RECENT_MESSAGES)
  for (let end = pool.length, number = 1; end > recentStart; end -= SCAN_CHUNK_LINES, number += 1) {
    const start = Math.max(recentStart, end - SCAN_CHUNK_LINES)
    chunks.push({ id: `r${number}`, text: render(pool.slice(start, end)) })
  }

  // The older part: only where it ran hot.
  const older = pool.slice(0, recentStart)
  hotWindows(older, HOT_WINDOW_COUNT).forEach((window, index) => {
    chunks.push({ id: `h${index + 1}`, text: render(older.slice(window.start, window.end)) })
  })

  const parts: ScanPart[] = []
  let current: ScanChunk[] = []
  let currentLines = 0

  for (const chunk of chunks) {
    const count = chunk.text.split('\n').length

    if (current.length > 0 && currentLines + count > SCAN_LINES_PER_PART) {
      parts.push({ metricId: `${SCAN_METRIC_PREFIX}${parts.length + 1}`, chunks: current })
      current = []
      currentLines = 0
    }

    current.push(chunk)
    currentLines += count
  }

  if (current.length > 0) {
    parts.push({ metricId: `${SCAN_METRIC_PREFIX}${parts.length + 1}`, chunks: current })
  }

  return { parts, lines }
}

/**
 * Turns what the AI answered — "412:ins" for each message it flagged — back into the messages
 * and the categories. An answer that is not a line the scan numbered, or not a code the scan
 * knows, is dropped: the browser trusts its own numbering, not the model's.
 */
export function parseScanFindings(
  lines: ReadonlyMap<number, string>,
  acceptedIds: readonly string[],
): Map<string, RedFlagCategoryId> {
  const found = new Map<string, RedFlagCategoryId>()

  for (const id of acceptedIds) {
    const [lineText, code] = id.split(':')
    const messageId = lines.get(Number(lineText))
    const category = code ? redFlagCategoryByScanCode(code.trim()) : null

    if (messageId && category) {
      found.set(messageId, category)
    }
  }

  return found
}
