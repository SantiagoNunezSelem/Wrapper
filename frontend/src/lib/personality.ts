import type {
  ChatMessage,
  Language,
  MetricDetail,
  MetricStat,
  ParticipantProfile,
  PersonalityLabelId,
  RadarDatum,
} from '../types'

// ---------------------------------------------------------------------------
// Personalities, read locally.
//
// This is the reading that needs no AI and sends nothing anywhere: it measures how each
// person writes in this chat — how often they open a conversation, how fast they answer,
// how long and how loud their messages are — compares them with the rest of the group, and
// picks the label from a closed list that fits best. It does two jobs:
//
//   1. It is the fallback. When the AI cannot write a person's profile, this is what the
//      card shows instead, and nothing else (see `gateCard` in metrics.ts).
//   2. Its numbers are what the AI is given alongside a sample of the person's messages
//      (see personalityAi.ts): "who is shy" cannot be read off forty messages, it has to be
//      measured against the rest of the group.
//
// It reads *behaviour in this chat*, not the person. The wording everywhere says so.
//
// This file must not import from metrics.ts — metrics.ts imports it, and the two would
// form a cycle. The one thing it needs from there (the conflict dictionary) comes in as a
// function (`FeatureDeps`).
// ---------------------------------------------------------------------------

/** Fewer text messages than this and a "personality" would be a guess about a handful of lines. */
export const MIN_MESSAGES_PER_PERSON = 50

/** Most people one chat's profiles cover. Mirrors `GoogleAi:MaxProfilePeople` on the backend. */
export const MAX_PROFILED_PEOPLE = 8

/**
 * The closed list, in the order that breaks a tie. Mirrors `AiProfilePrompts.LabelIds` on
 * the backend — both sides reject anything outside it.
 */
export const PERSONALITY_LABEL_IDS: readonly PersonalityLabelId[] = [
  'confianzudo',
  'timido',
  'suizo',
  'agresivo',
  'bromista',
  'intenso',
  'carinoso',
  'lider',
  'dramatico',
  'seco',
  'curioso',
  'quejoso',
]

export function isPersonalityLabelId(value: string | null | undefined): value is PersonalityLabelId {
  return typeof value === 'string' && (PERSONALITY_LABEL_IDS as readonly string[]).includes(value)
}

const labelNames: Record<Language, Record<PersonalityLabelId, string>> = {
  es: {
    confianzudo: 'Confianzudo',
    timido: 'Tímido',
    suizo: 'Suizo',
    agresivo: 'Agresivo',
    bromista: 'Bromista',
    intenso: 'Intenso',
    carinoso: 'Cariñoso',
    lider: 'Líder',
    dramatico: 'Dramático',
    seco: 'Seco',
    curioso: 'Curioso',
    quejoso: 'Quejoso',
  },
  en: {
    confianzudo: 'Over-familiar',
    timido: 'Shy',
    suizo: 'Neutral',
    agresivo: 'Aggressive',
    bromista: 'Joker',
    intenso: 'Intense',
    carinoso: 'Affectionate',
    lider: 'Leader',
    dramatico: 'Dramatic',
    seco: 'Dry',
    curioso: 'Curious',
    quejoso: 'Complainer',
  },
}

export function personalityLabelName(labelId: PersonalityLabelId, language: Language): string {
  return labelNames[language][labelId]
}

/**
 * A face for each label — this card is made to be looked at, and shared. All of them are
 * old enough to draw on a Windows 10 machine, and none is a flag (Windows draws those as
 * two letters).
 */
const labelEmojis: Record<PersonalityLabelId, string> = {
  confianzudo: '🤝',
  timido: '🙈',
  suizo: '⚖️',
  agresivo: '🥊',
  bromista: '😂',
  intenso: '⚡',
  carinoso: '🥰',
  lider: '👑',
  dramatico: '🎭',
  seco: '🌵',
  curioso: '🔍',
  quejoso: '😤',
}

export function personalityEmoji(labelId: PersonalityLabelId): string {
  return labelEmojis[labelId]
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

export const FEATURE_KEYS = [
  'share',
  'initiative',
  'replyMinutes',
  'avgWords',
  'shortRate',
  'emojiRate',
  'laughRate',
  'capsRate',
  'exclRate',
  'questionRate',
  'burstRate',
  'affectionRate',
  'conflictRate',
  'complaintRate',
  'vocativeRate',
  'planRate',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

/** One person's measured behaviour. `replyMinutes` is null when they answered too rarely to say. */
export type PersonFeatures = Record<Exclude<FeatureKey, 'replyMinutes'>, number> & {
  replyMinutes: number | null
}

export interface PersonStats {
  name: string
  /** Text messages — media placeholders do not count. */
  messageCount: number
  features: PersonFeatures
}

export interface FeatureDeps {
  /** Whether a message reads as a reproach or a clash. Injected: the dictionary lives in metrics.ts. */
  isConflict: (text: string) => boolean
}

/** A gap this long between two messages means somebody started a new conversation. */
const OPENING_GAP_MS = 3 * 60 * 60 * 1000

/** An answer later than this is not an answer to the message before it. */
const REPLY_WINDOW_MINUTES = 360

/** Fewer answers than this and the median says nothing. */
const MIN_REPLY_SAMPLES = 5

/** A message sent this soon after your own previous one is part of a burst. */
const BURST_GAP_MS = 60 * 1000

/** Lowercase and without accents, so one pattern matches "cariño", "Cariño" and "carino". */
export function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const emojiPattern = /\p{Extended_Pictographic}/gu

// All of these run on `fold`ed text.
const laughPattern = /\b(?:[jh][aeiou]){2,}[jh]?\b|\blo+l\b|\blmao\b|\bxd+\b|\bk{3,}\b|[😂🤣😹]/u
const affectionPattern =
  /\b(?:te quiero|te amo|te adoro|te extrano|mi amor|amor|carino|bebe|bebita|corazon|abrazo|abrazote|besos?|besito|hermos[oa]|lind[oa]|precios[oa]|love you|miss you|my love|babe|honey|sweetie)\b|[❤💕💖💗💘💞😘🥰😍🤗💙💜💛💚🧡🤍]/u
const complaintPattern =
  /\b(?:odio|harto|harta|cansad[oa]|no aguanto|que asco|que fiaca|que bajon|me aburro|aburrid[oa]|insoportable|una porqueria|que pesad[oa]|siempre lo mismo|no puedo creer|que mal|estoy podrid[oa]|fastidi[oa]|hate|so tired|annoying|ugh|worst|sick of|fed up|cant stand)\b/u
const vocativePattern =
  /(?:^|\s)(?:che|loco|loca|hermano|hermana|amigo|amiga|bro|bruh|brother|dude|boludo|boluda|pibe|piba|flaco|flaca|capo|capa|crack|wacho|nene|nena|mostro|maquina)(?=[\s,.!?]|$)/u
const planPattern =
  /\b(?:vamos|vamo|hagamos|juntemos|juntamos|quedamos|quedemos|nos vemos|venis|venes|vienen|vengan|salimos|salgamos|a que hora|manana|mas tarde|esta noche|hoy a la noche|el finde|este finde|lets|let's|tonight|tomorrow|meet up|are you coming|wanna)\b/u

function isText(message: ChatMessage): boolean {
  return !message.isSystemPlaceholder && message.contentText.trim().length > 0
}

function isShouting(text: string): boolean {
  const letters = text.match(/\p{L}/gu)

  if (!letters || letters.length < 5) {
    return false
  }

  const upper = letters.filter((letter) => letter !== letter.toLowerCase()).length
  return upper >= 4 && upper / letters.length >= 0.7
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

interface Tally {
  texts: number
  words: number
  short: number
  emojis: number
  laughs: number
  caps: number
  excl: number
  questions: number
  bursts: number
  affection: number
  conflict: number
  complaints: number
  vocatives: number
  plans: number
  openings: number
  replyDelays: number[]
}

function newTally(): Tally {
  return {
    texts: 0,
    words: 0,
    short: 0,
    emojis: 0,
    laughs: 0,
    caps: 0,
    excl: 0,
    questions: 0,
    bursts: 0,
    affection: 0,
    conflict: 0,
    complaints: 0,
    vocatives: 0,
    plans: 0,
    openings: 0,
    replyDelays: [],
  }
}

/**
 * Measures every person with enough messages to say something about, most active first.
 * One pass over the chat: the first half decides who qualifies, the second does the
 * counting for those people only, so a 30-person group does not pay for the 22 who wrote
 * four messages.
 */
export function extractFeatures(chatMessages: ChatMessage[], deps: FeatureDeps): PersonStats[] {
  const counts = new Map<string, number>()

  for (const message of chatMessages) {
    if (message.sender && isText(message)) {
      counts.set(message.sender, (counts.get(message.sender) ?? 0) + 1)
    }
  }

  let totalTexts = 0
  for (const count of counts.values()) {
    totalTexts += count
  }

  // Map keeps first-appearance order and `sort` is stable, so a tie goes to whoever spoke first.
  const eligible = [...counts.entries()]
    .filter(([, count]) => count >= MIN_MESSAGES_PER_PERSON)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_PROFILED_PEOPLE)
    .map(([name]) => name)

  if (eligible.length === 0) {
    return []
  }

  const tallies = new Map(eligible.map((name) => [name, newTally()]))
  let totalOpenings = 0
  let previous: ChatMessage | null = null
  let previousTime = Number.NaN

  for (const message of chatMessages) {
    const sender = message.sender

    if (!sender) {
      continue
    }

    const time = Date.parse(message.timestamp)
    const tally = tallies.get(sender)

    if (previous === null) {
      totalOpenings += 1
      if (tally) {
        tally.openings += 1
      }
    } else if (Number.isFinite(time) && Number.isFinite(previousTime)) {
      const gap = time - previousTime

      if (gap >= OPENING_GAP_MS) {
        totalOpenings += 1
        if (tally) {
          tally.openings += 1
        }
      } else if (previous.sender !== sender) {
        const minutes = gap / 60000
        if (tally && minutes >= 0 && minutes <= REPLY_WINDOW_MINUTES) {
          tally.replyDelays.push(minutes)
        }
      } else if (tally && gap >= 0 && gap <= BURST_GAP_MS && isText(message)) {
        tally.bursts += 1
      }
    }

    if (tally && isText(message)) {
      const text = message.contentText
      const folded = fold(text)

      tally.texts += 1
      tally.words += message.wordCount
      tally.short += message.wordCount <= 3 ? 1 : 0
      tally.emojis += text.match(emojiPattern)?.length ?? 0
      tally.laughs += laughPattern.test(folded) ? 1 : 0
      tally.caps += isShouting(text) ? 1 : 0
      tally.excl += text.includes('!') ? 1 : 0
      tally.questions += text.includes('?') ? 1 : 0
      tally.affection += affectionPattern.test(folded) ? 1 : 0
      tally.conflict += deps.isConflict(text) ? 1 : 0
      tally.complaints += complaintPattern.test(folded) ? 1 : 0
      tally.vocatives += vocativePattern.test(folded) ? 1 : 0
      tally.plans += planPattern.test(folded) ? 1 : 0
    }

    previous = message
    previousTime = time
  }

  return eligible.map((name) => {
    const tally = tallies.get(name)!
    const n = tally.texts

    return {
      name,
      messageCount: n,
      features: {
        share: n / totalTexts,
        initiative: totalOpenings > 0 ? tally.openings / totalOpenings : 0,
        replyMinutes: tally.replyDelays.length >= MIN_REPLY_SAMPLES ? median(tally.replyDelays) : null,
        avgWords: tally.words / n,
        shortRate: tally.short / n,
        emojiRate: tally.emojis / n,
        laughRate: tally.laughs / n,
        capsRate: tally.caps / n,
        exclRate: tally.excl / n,
        questionRate: tally.questions / n,
        burstRate: tally.bursts / n,
        affectionRate: tally.affection / n,
        conflictRate: tally.conflict / n,
        complaintRate: tally.complaints / n,
        vocativeRate: tally.vocatives / n,
        planRate: tally.plans / n,
      },
    }
  })
}

/** The numbers as they travel: rounded, and without the one that may be unknown. */
export function toWireFeatures(features: PersonFeatures): Record<string, number> {
  const wire: Record<string, number> = {}

  for (const key of FEATURE_KEYS) {
    const value = features[key]

    if (value !== null && Number.isFinite(value)) {
      wire[key] = Math.round(value * 1000) / 1000
    }
  }

  return wire
}

/** The group's average for every number — what each person is compared against. */
export function groupAverages(stats: PersonStats[]): Record<string, number> {
  const averages: Record<string, number> = {}

  for (const key of FEATURE_KEYS) {
    const values = stats
      .map((person) => person.features[key])
      .filter((value): value is number => value !== null && Number.isFinite(value))

    if (values.length > 0) {
      averages[key] = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
    }
  }

  return averages
}

// ---------------------------------------------------------------------------
// Comparing with the group
// ---------------------------------------------------------------------------

type ScoreKey =
  | 'share'
  | 'initiative'
  | 'speed'
  | 'len'
  | 'short'
  | 'emoji'
  | 'laugh'
  | 'caps'
  | 'excl'
  | 'question'
  | 'burst'
  | 'affection'
  | 'conflict'
  | 'complaint'
  | 'vocative'
  | 'plan'

type TermKey = ScoreKey | 'calm' | 'mid'

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Where a value sits among the others, 0 for the lowest and 1 for the highest, ties sharing
 * the middle of their rank. A group of one has no "among", so it sits in the middle.
 */
export function rankScores(values: number[]): number[] {
  if (values.length < 2) {
    return values.map(() => 0.5)
  }

  return values.map((value) => {
    const below = values.filter((other) => other < value).length
    const equal = values.filter((other) => other === value).length
    return (below + (equal - 1) / 2) / (values.length - 1)
  })
}

/** How a raw value reads on its own, ignoring the group: 1 is "a lot" for a normal chat. */
const absoluteScore: Record<ScoreKey, (value: number, people: number) => number> = {
  share: (value, people) => clamp01((value * people) / 2),
  initiative: (value, people) => clamp01((value * people) / 2),
  speed: (value) => clamp01(value),
  len: (value) => clamp01(value / 20),
  short: (value) => clamp01(value),
  emoji: (value) => clamp01(value),
  laugh: (value) => clamp01(value / 0.35),
  caps: (value) => clamp01(value / 0.1),
  excl: (value) => clamp01(value / 0.3),
  question: (value) => clamp01(value / 0.3),
  burst: (value) => clamp01(value / 0.5),
  affection: (value) => clamp01(value / 0.12),
  conflict: (value) => clamp01(value / 0.06),
  complaint: (value) => clamp01(value / 0.06),
  vocative: (value) => clamp01(value / 0.15),
  plan: (value) => clamp01(value / 0.08),
}

function speedOf(minutes: number): number {
  return 1 - clamp01(Math.log1p(minutes) / Math.log1p(REPLY_WINDOW_MINUTES))
}

/**
 * Every person's score for every measure, 0 to 1. Half how they compare with the group
 * and half how the value reads on its own: with only two people "more than the other" is
 * true of one of them whatever the numbers are, and the absolute half keeps a chat of two
 * quiet people from producing a loud one.
 */
function scoreTable(people: PersonStats[]): Record<TermKey, number[]> {
  const count = people.length
  const relativeWeight = count >= 4 ? 0.5 : count === 3 ? 0.4 : 0.3

  const known = people
    .map((person) => person.features.replyMinutes)
    .filter((minutes): minutes is number => minutes !== null)
    .map(speedOf)
  const fallbackSpeed = known.length > 0 ? median(known) : 0.5

  const raw: Record<ScoreKey, number[]> = {
    share: people.map((person) => person.features.share),
    initiative: people.map((person) => person.features.initiative),
    speed: people.map((person) =>
      person.features.replyMinutes === null ? fallbackSpeed : speedOf(person.features.replyMinutes),
    ),
    len: people.map((person) => person.features.avgWords),
    short: people.map((person) => person.features.shortRate),
    emoji: people.map((person) => person.features.emojiRate),
    laugh: people.map((person) => person.features.laughRate),
    caps: people.map((person) => person.features.capsRate),
    excl: people.map((person) => person.features.exclRate),
    question: people.map((person) => person.features.questionRate),
    burst: people.map((person) => person.features.burstRate),
    affection: people.map((person) => person.features.affectionRate),
    conflict: people.map((person) => person.features.conflictRate),
    complaint: people.map((person) => person.features.complaintRate),
    vocative: people.map((person) => person.features.vocativeRate),
    plan: people.map((person) => person.features.planRate),
  }

  const table = {} as Record<TermKey, number[]>

  for (const key of Object.keys(raw) as ScoreKey[]) {
    const relative = rankScores(raw[key])
    table[key] = raw[key].map(
      (value, index) => relativeWeight * relative[index] + (1 - relativeWeight) * absoluteScore[key](value, count),
    )
  }

  // Two measures that are not a single column: how little a person stirs things up, and how
  // close to an even share of the talking they are. "Neutral" is both, at once.
  table.calm = people.map((_, index) => 1 - Math.max(table.conflict[index], table.caps[index], table.excl[index]))
  table.mid = people.map((_, index) => 1 - Math.abs(2 * table.share[index] - 1))

  return table
}

/** [measure, weight, inverted]. Inverted means *less* of it fits the label. */
type Term = readonly [TermKey, number, boolean?]

const labelTerms: Record<PersonalityLabelId, readonly Term[]> = {
  confianzudo: [['vocative', 0.45], ['laugh', 0.2], ['emoji', 0.1], ['initiative', 0.1], ['burst', 0.05]],
  timido: [['share', 0.35, true], ['initiative', 0.25, true], ['short', 0.2], ['burst', 0.1, true], ['excl', 0.1, true]],
  suizo: [['calm', 0.35], ['mid', 0.25], ['conflict', 0.2, true], ['caps', 0.1, true], ['complaint', 0.1, true]],
  agresivo: [['conflict', 0.45], ['caps', 0.2], ['excl', 0.1], ['affection', 0.15, true], ['complaint', 0.1]],
  bromista: [['laugh', 0.5], ['emoji', 0.15], ['vocative', 0.15], ['burst', 0.1], ['share', 0.1]],
  intenso: [['share', 0.3], ['burst', 0.3], ['len', 0.15], ['excl', 0.15], ['caps', 0.1]],
  carinoso: [['affection', 0.55], ['emoji', 0.25], ['conflict', 0.2, true]],
  lider: [['initiative', 0.4], ['plan', 0.3], ['share', 0.2], ['speed', 0.1]],
  dramatico: [['caps', 0.35], ['excl', 0.3], ['emoji', 0.15], ['len', 0.1], ['complaint', 0.1]],
  seco: [['short', 0.4], ['emoji', 0.25, true], ['laugh', 0.2, true], ['affection', 0.15, true]],
  curioso: [['question', 0.7], ['initiative', 0.2], ['speed', 0.1]],
  quejoso: [['complaint', 0.55], ['conflict', 0.15], ['laugh', 0.15, true], ['affection', 0.15, true]],
}

function labelScore(table: Record<TermKey, number[]>, labelId: PersonalityLabelId, index: number): number {
  let total = 0
  let weights = 0

  for (const [key, weight, inverted] of labelTerms[labelId]) {
    const value = table[key][index]
    total += weight * (inverted ? 1 - value : value)
    weights += weight
  }

  return total / weights
}

/**
 * Each person's label is the one they stand out for, not the one they score highest on:
 * everybody in a chat of friends scores high on "Bromista", and the one who gets the label is
 * whoever laughs more than the rest. A little of the raw score is kept, so a label nobody
 * really earns does not go to whoever happens to be least far from nothing.
 */
function pickLabels(
  table: Record<TermKey, number[]>,
  count: number,
): { primary: PersonalityLabelId; secondary?: PersonalityLabelId }[] {
  const people = Array.from({ length: count }, (_, index) => index)
  const scores = PERSONALITY_LABEL_IDS.map((labelId) => people.map((index) => labelScore(table, labelId, index)))
  const means = scores.map((column) => column.reduce((sum, value) => sum + value, 0) / column.length)

  return people.map((index) => {
    const ranked = PERSONALITY_LABEL_IDS.map((labelId, labelIndex) => ({
      labelId,
      standout: scores[labelIndex][index] - means[labelIndex] + 0.35 * scores[labelIndex][index],
    })).sort((left, right) => right.standout - left.standout)

    const [first, second] = ranked
    const hasSecond = first.standout > 0 && second.standout > 0.05 && second.standout >= 0.75 * first.standout

    return { primary: first.labelId, secondary: hasSecond ? second.labelId : undefined }
  })
}

// ---------------------------------------------------------------------------
// Saying it
// ---------------------------------------------------------------------------

const radarAxes: Record<Language, readonly string[]> = {
  es: ['Presencia', 'Iniciativa', 'Rapidez', 'Expresividad', 'Detalle', 'Curiosidad'],
  en: ['Presence', 'Initiative', 'Speed', 'Expressiveness', 'Detail', 'Curiosity'],
}

function radarFor(table: Record<TermKey, number[]>, index: number, language: Language): RadarDatum[] {
  const expressiveness = (table.emoji[index] + table.laugh[index] + table.excl[index]) / 3
  const values = [table.share[index], table.initiative[index], table.speed[index], expressiveness, table.len[index], table.question[index]]

  return radarAxes[language].map((axis, position) => ({ axis, value: Math.round(values[position] * 100) }))
}

const intros: Record<Language, Record<PersonalityLabelId, string>> = {
  es: {
    confianzudo: 'Se toma confianza enseguida: trata a todos con apodos y bromas.',
    timido: 'Habla poco y mide lo que dice.',
    suizo: 'Se mantiene neutral: casi no entra en discusiones ni toma partido.',
    agresivo: 'Su tono tira a confrontativo: reproches y respuestas cortantes.',
    bromista: 'Vive de la broma: risas, cargadas y humor todo el tiempo.',
    intenso: 'Va a fondo: escribe mucho y en ráfagas.',
    carinoso: 'Expresa afecto seguido: cariño, apoyo y emojis tiernos.',
    lider: 'Mueve al grupo: arranca conversaciones y propone planes.',
    dramatico: 'Todo lo vive en grande: mayúsculas, exclamaciones y exageración.',
    seco: 'Va al grano: respuestas mínimas y poca expresividad.',
    curioso: 'Pregunta todo: siempre quiere saber más.',
    quejoso: 'Se queja seguido y ve el lado negativo.',
  },
  en: {
    confianzudo: 'Gets familiar fast: nicknames and jokes with everyone.',
    timido: 'Talks little and measures every word.',
    suizo: 'Stays neutral: rarely joins arguments or takes sides.',
    agresivo: 'Leans confrontational: reproaches and curt replies.',
    bromista: 'Lives on jokes: laughs, teasing and humor all the time.',
    intenso: 'Goes all in: writes a lot, in bursts.',
    carinoso: 'Shows affection often: warmth, support and sweet emojis.',
    lider: 'Moves the group: starts conversations and proposes plans.',
    dramatico: 'Lives everything big: capital letters, exclamations and exaggeration.',
    seco: 'Gets to the point: minimal replies and little expression.',
    curioso: 'Asks about everything: always wants to know more.',
    quejoso: 'Complains often and sees the negative side.',
  },
}

/** A measure a sentence can be written about. Reply time is shown on the radar, not in prose. */
type FactKey = Exclude<FeatureKey, 'replyMinutes'>

/** The two measures that best back each label up, in order. */
const labelFacts: Record<PersonalityLabelId, readonly [FactKey, FactKey]> = {
  confianzudo: ['vocativeRate', 'laughRate'],
  timido: ['share', 'initiative'],
  suizo: ['conflictRate', 'share'],
  agresivo: ['conflictRate', 'capsRate'],
  bromista: ['laughRate', 'emojiRate'],
  intenso: ['share', 'burstRate'],
  carinoso: ['affectionRate', 'emojiRate'],
  lider: ['initiative', 'planRate'],
  dramatico: ['capsRate', 'exclRate'],
  seco: ['shortRate', 'emojiRate'],
  curioso: ['questionRate', 'initiative'],
  quejoso: ['complaintRate', 'conflictRate'],
}

function formatNumber(value: number, language: Language): string {
  return value.toLocaleString(language === 'es' ? 'es-AR' : 'en-US', { maximumFractionDigits: 1 })
}

/** "el 12%", or "menos del 1%" — the article is part of the phrase because the small case has none. */
function percentPhrase(value: number, language: Language): string {
  if (value < 0.01) {
    return language === 'es' ? 'menos del 1%' : 'under 1%'
  }

  const percent = formatNumber(value * 100, language)
  return language === 'es' ? `el ${percent}%` : `${percent}%`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

type FactWriter = (value: number, language: Language) => string

/** "El 12% de sus mensajes <rest>" — one shape for every measure that is a share of the person's messages. */
function messageShare(es: string, en: string): FactWriter {
  return (value, language) =>
    language === 'es'
      ? `${capitalize(percentPhrase(value, language))} de sus mensajes ${es}`
      : `${capitalize(percentPhrase(value, language))} of their messages ${en}`
}

const factWriters: Record<FactKey, FactWriter> = {
  share: (value, language) =>
    language === 'es'
      ? `Escribe ${percentPhrase(value, language)} de los mensajes del chat`
      : `Writes ${percentPhrase(value, language)} of the chat's messages`,
  initiative: (value, language) =>
    language === 'es'
      ? `Arranca ${percentPhrase(value, language)} de las conversaciones`
      : `Starts ${percentPhrase(value, language)} of the conversations`,
  avgWords: (value, language) =>
    language === 'es'
      ? `Sus mensajes tienen ${formatNumber(value, language)} palabras en promedio`
      : `Their messages average ${formatNumber(value, language)} words`,
  shortRate: messageShare('son de tres palabras o menos', 'are three words or fewer'),
  emojiRate: (value, language) =>
    language === 'es'
      ? `Usa ${formatNumber(value, language)} emojis por mensaje`
      : `Uses ${formatNumber(value, language)} emojis per message`,
  laughRate: messageShare('llevan risas', 'carry laughs'),
  capsRate: messageShare('están en mayúsculas', 'are in capital letters'),
  exclRate: messageShare('llevan exclamaciones', 'have exclamation marks'),
  questionRate: messageShare('son preguntas', 'are questions'),
  burstRate: messageShare('llegan en ráfaga, uno tras otro', 'come in bursts, one after another'),
  affectionRate: messageShare('son cariñosos', 'are affectionate'),
  conflictRate: messageShare('tienen tono de reproche o conflicto', 'sound like a reproach or a clash'),
  complaintRate: messageShare('son quejas', 'are complaints'),
  vocativeRate: messageShare(
    'llevan apodos o vocativos como "che" o "hermano"',
    'use nicknames or vocatives like "bro" or "dude"',
  ),
  planRate: messageShare('proponen planes', 'propose plans'),
}

/** " (más que el promedio del grupo)" when the person is clearly above or below it. */
function versusGroup(value: number, average: number | undefined, language: Language): string {
  if (average === undefined || average <= 0) {
    return ''
  }

  const ratio = value / average

  if (ratio >= 1.3) {
    return language === 'es' ? ' (más que el promedio del grupo)' : ' (above the group average)'
  }

  return ratio <= 0.7 ? (language === 'es' ? ' (menos que el promedio del grupo)' : ' (below the group average)') : ''
}

function summaryFor(
  labelId: PersonalityLabelId,
  features: PersonFeatures,
  average: Record<string, number>,
  language: Language,
): string {
  const facts = labelFacts[labelId].map(
    (key) => `${factWriters[key](features[key], language)}${versusGroup(features[key], average[key], language)}.`,
  )

  return [intros[language][labelId], ...facts].join(' ')
}

/**
 * The local reading, ready for the card. Sorted by who writes most, which is also the order
 * the AI input numbers people in — the letters line up without anyone having to carry a map.
 */
export function profilesFromStats(stats: PersonStats[], language: Language): ParticipantProfile[] {
  if (stats.length === 0) {
    return []
  }

  const table = scoreTable(stats)
  const labels = pickLabels(table, stats.length)
  const average = groupAverages(stats)

  return stats.map((person, index) => {
    const { primary, secondary } = labels[index]

    return {
      name: person.name,
      labelId: primary,
      label: personalityLabelName(primary, language),
      ...(secondary ? { secondaryLabelId: secondary, secondaryLabel: personalityLabelName(secondary, language) } : {}),
      summary: summaryFor(primary, person.features, average, language),
      source: 'local' as const,
      radar: radarFor(table, index, language),
      messageCount: person.messageCount,
    }
  })
}

/** What the AI decided for one person. */
export interface ProfileOverride {
  labelId: PersonalityLabelId
  secondaryLabelId?: PersonalityLabelId
  summary: string
}

/** Swaps in what the AI wrote for the people it wrote it for, and leaves the rest as measured. */
export function mergeProfileOverrides(
  profiles: ParticipantProfile[],
  overrides: ReadonlyMap<string, ProfileOverride>,
  language: Language,
): ParticipantProfile[] {
  return profiles.map((profile) => {
    const override = overrides.get(profile.name)

    if (!override) {
      return profile
    }

    const { secondaryLabelId: _previousId, secondaryLabel: _previousLabel, ...rest } = profile

    return {
      ...rest,
      labelId: override.labelId,
      label: personalityLabelName(override.labelId, language),
      ...(override.secondaryLabelId
        ? {
            secondaryLabelId: override.secondaryLabelId,
            secondaryLabel: personalityLabelName(override.secondaryLabelId, language),
          }
        : {}),
      summary: override.summary,
      source: 'ai' as const,
    }
  })
}

export interface ProfilesResult {
  hasData: boolean
  basic?: MetricStat
  detail?: MetricDetail
}

/**
 * The card around the profiles. The headline is the most active person's personality — the
 * one reading that is always true to say, whatever the rest of the group looks like — and the
 * chart is that person's radar.
 */
export function profilesResult(profiles: ParticipantProfile[], language: Language): ProfilesResult {
  if (profiles.length < 2) {
    return { hasData: false }
  }

  const lead = profiles[0]

  return {
    hasData: true,
    basic: {
      value: lead.label,
      label:
        language === 'es'
          ? `la personalidad de ${lead.name}, quien más escribe`
          : `${lead.name}'s personality, the most active`,
      chart: { kind: 'radar', axes: lead.radar },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Cada integrante con su personalidad y por qué, según cómo escribe en este chat.'
          : "Each participant's personality and why, based on how they write in this chat.",
      profiles,
    },
  }
}
