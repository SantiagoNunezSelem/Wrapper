import type { AiCardState, AiProfileState, ChatMessage } from '../types'
import {
  createMetricContext,
  matchAiKeywordExplicit,
  matchAiKeywordGeneral,
  matchAiKeywordModerate,
  matchesConflict,
} from './metrics'
import {
  extractFeatures,
  groupAverages,
  isPersonalityLabelId,
  toWireFeatures,
  type PersonStats,
  type ProfileOverride,
} from './personality'

// ---------------------------------------------------------------------------
// What the AI is given to write the personalities, and what is done with its answer.
//
// The rule that governs this whole file is the one the keyword-hit metrics already live by:
// tokens are the running cost of the feature, and what leaves the browser is as little as
// can still be judged well. So per person it is two things — the measured numbers (which cost
// next to nothing and are what lets "shy" be judged against the group) and a short sample of
// their messages, picked to be spread over time, scrubbed of names and contact details, and
// with the sexual vocabulary left out (it adds nothing to a personality, and it is what trips
// Gemini's safety floor).
// ---------------------------------------------------------------------------

/**
 * Messages per person in the sample. Mirrors `GoogleAi:MaxProfileMessages` on the backend,
 * which enforces the same ceiling: people × this × `PROFILE_MESSAGE_WORDS` is the worst case
 * a chat can cost, and it stays under the cap the keyword-hit metrics already respect.
 */
export const PROFILE_SAMPLE_SIZE = 40

/** Each sample message is cropped to this many words. */
export const PROFILE_MESSAGE_WORDS = 25

/** A person with fewer usable sample messages than this is left to the local reading. */
export const MIN_SAMPLE_MESSAGES = 10

/** Messages of at least this many words say something about how a person writes; shorter ones are texture. */
const INFORMATIVE_WORDS = 5

/** Share of the sample drawn from the informative messages — the rest keeps the short replies in the picture. */
const INFORMATIVE_SHARE = 0.7

export interface ProfileInputPerson {
  /** The letter the server knows this person by. The name never travels. */
  id: string
  /** Kept only so the answer can be mapped back to a real participant; `toProfilePayload` drops it. */
  name: string
  features: Record<string, number>
  messages: string[]
}

export interface ProfileInput {
  people: ProfileInputPerson[]
  /** The group's average for every number, for the model to compare each person against. */
  group: Record<string, number>
}

/** What `POST /api/ai/profiles` carries: the same input minus every real name. */
export function toProfilePayload(input: ProfileInput): {
  group: Record<string, number>
  people: { id: string; features: Record<string, number>; messages: string[] }[]
} {
  return {
    group: input.group,
    people: input.people.map(({ id, features, messages }) => ({ id, features, messages })),
  }
}

function letterFor(index: number): string {
  return String.fromCharCode(65 + index)
}

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------

const urlPattern = /https?:\/\/\S+|www\.\S+/giu
const emailPattern = /[\w.+-]+@[\w-]+\.[\w.-]+/gu
const phonePattern = /\+?\d[\d\s().-]{6,}\d/gu
const placeholderPattern = /\[(?:link|mail|número|otro)\]/gu

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The pieces of a participant's name worth hiding: the whole thing and each word of three letters or more. */
function nameTokens(name: string): string[] {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && /\p{L}/u.test(word))

  return [...new Set([name.trim(), ...words].filter((token) => token.length >= 3 && /\p{L}/u.test(token)))]
}

/**
 * Hides who is who. Names inside the text are as identifying as the speaker label, so each
 * participant's name becomes the letter the server knows them by (or `[otro]` for someone
 * who is not in the sample), and links, mail addresses and phone numbers are removed.
 */
function buildScrubber(participants: string[], letters: Map<string, string>): (text: string) => string {
  const rules = participants
    .flatMap((name) =>
      nameTokens(name).map((token) => ({
        token,
        replacement: letters.get(name) ?? '[otro]',
        pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(token)}(?![\\p{L}\\p{N}_])`, 'giu'),
      })),
    )
    // Longest first, so "Ana María" goes whole before "Ana" gets the chance to leave "María" behind.
    .sort((left, right) => right.token.length - left.token.length)

  return (text) => {
    let scrubbed = text.replace(urlPattern, '[link]').replace(emailPattern, '[mail]').replace(phonePattern, '[número]')

    for (const rule of rules) {
      scrubbed = scrubbed.replace(rule.pattern, rule.replacement)
    }

    return scrubbed
  }
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

function isSexual(text: string): boolean {
  return (
    matchAiKeywordExplicit('tonopicante', text) !== null ||
    matchAiKeywordModerate('tonopicante', text) !== null ||
    matchAiKeywordGeneral('tonopicante', text) !== null
  )
}

function clampWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean)
  return words.length <= maxWords ? words.join(' ') : `${words.slice(0, maxWords).join(' ')} …`
}

/** Whether anything is left once the placeholders are taken out. */
function hasContent(text: string): boolean {
  return text.replace(placeholderPattern, '').trim().length > 0
}

interface Candidate {
  message: ChatMessage
  index: number
}

/**
 * `count` items spread evenly over `list`, skipping any that `accept` refuses by moving on
 * to the next unused one. Even spacing, not random: the same chat always yields the same
 * sample, which is what lets a stored profile be recognised on the next upload.
 */
function pickEvenly(list: Candidate[], count: number, accept: (candidate: Candidate) => boolean): Candidate[] {
  const taken = new Set<number>()

  for (let slot = 0; slot < count; slot += 1) {
    const start = Math.floor(((slot + 0.5) * list.length) / count)

    for (let step = 0; step < list.length; step += 1) {
      const position = (start + step) % list.length

      if (!taken.has(position) && accept(list[position])) {
        taken.add(position)
        break
      }
    }
  }

  return [...taken].map((position) => list[position])
}

/** One person's sample: mostly messages that say something, some short ones, in chat order. */
function sampleFor(texts: ChatMessage[], scrub: (text: string) => string): string[] {
  const candidates = texts.map((message, index) => ({ message, index }))
  const informative = candidates.filter(({ message }) => message.wordCount >= INFORMATIVE_WORDS)
  const brief = candidates.filter(
    ({ message }) => message.wordCount < INFORMATIVE_WORDS && /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(message.contentText),
  )
  const accept = ({ message }: Candidate) => !isSexual(message.contentText)

  const informativeTarget = Math.min(
    informative.length,
    Math.max(Math.ceil(PROFILE_SAMPLE_SIZE * INFORMATIVE_SHARE), PROFILE_SAMPLE_SIZE - brief.length),
  )
  const briefTarget = Math.min(brief.length, PROFILE_SAMPLE_SIZE - informativeTarget)

  return [...pickEvenly(informative, informativeTarget, accept), ...pickEvenly(brief, briefTarget, accept)]
    .sort((left, right) => left.index - right.index)
    .map(({ message }) => clampWords(scrub(message.contentText.trim()), PROFILE_MESSAGE_WORDS))
    .filter(hasContent)
}

/**
 * Everything the AI is given for one chat. Runs in the worker, like the candidates for the
 * keyword-hit metrics: it walks every message.
 */
export function buildProfileInput(messages: ChatMessage[]): ProfileInput {
  const context = createMetricContext(messages, 'es')
  const stats = extractFeatures(context.chatMessages, { isConflict: matchesConflict })
  const letters = new Map(stats.map((person, index) => [person.name, letterFor(index)]))
  const scrub = buildScrubber(context.participants, letters)

  const people: ProfileInputPerson[] = []
  const covered: PersonStats[] = []

  for (const person of stats) {
    const sample = sampleFor(context.textMessagesBySender.get(person.name) ?? [], scrub)

    if (sample.length < MIN_SAMPLE_MESSAGES) {
      continue
    }

    people.push({
      id: letters.get(person.name)!,
      name: person.name,
      features: toWireFeatures(person.features),
      messages: sample,
    })
    covered.push(person)
  }

  return { people, group: groupAverages(covered) }
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

function indexById(results: AiProfileState[]): Map<string, AiProfileState> {
  return new Map(results.map((result) => [result.personId, result]))
}

/**
 * The people the AI wrote a profile for, by real name. Anyone it did not — a failure, a
 * label outside the list, an empty summary — is simply absent, and the card keeps the local
 * reading for them.
 */
export function toProfileOverrides(input: ProfileInput, results: AiProfileState[]): Map<string, ProfileOverride> {
  const byId = indexById(results)
  const overrides = new Map<string, ProfileOverride>()

  for (const person of input.people) {
    const result = byId.get(person.id)

    if (result?.status !== 'ready' || !isPersonalityLabelId(result.labelId) || !result.summary) {
      continue
    }

    const secondary =
      isPersonalityLabelId(result.secondaryLabelId) && result.secondaryLabelId !== result.labelId
        ? result.secondaryLabelId
        : undefined

    overrides.set(person.name, { labelId: result.labelId, secondaryLabelId: secondary, summary: result.summary })
  }

  return overrides
}

/**
 * The card's AI state. Ready only when every person the browser asked about came back
 * ready; otherwise `failed`, with the first reason and the *latest* retry time, so the button
 * does not offer a retry that some person's cooldown would still refuse.
 */
export function profileCardState(input: ProfileInput, results: AiProfileState[]): AiCardState {
  const byId = indexById(results)
  const failures = input.people
    .map((person) => byId.get(person.id))
    .filter((result) => result?.status !== 'ready')

  if (failures.length === 0) {
    return { status: 'ready' }
  }

  const retryTimes = failures
    .map((result) => result?.retryAvailableAtUtc)
    .filter((time): time is string => Boolean(time))

  return {
    status: 'failed',
    errorCode: failures.find((result) => result?.errorCode)?.errorCode ?? null,
    retryAvailableAtUtc:
      retryTimes.length > 0 ? retryTimes.reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest)) : null,
  }
}
