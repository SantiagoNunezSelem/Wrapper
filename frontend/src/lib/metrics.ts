import type {
  AnalysisBundle,
  BarDatum,
  CalendarDay,
  ChatBubble,
  ChatMessage,
  ChartData,
  Language,
  MessageGroup,
  MetricCard,
  MetricDetail,
  MetricSeriesEntry,
  MetricStat,
  MonthDatum,
  ParticipantBreakdownEntry,
  RadarDatum,
  StreakRange,
  TimelinePoint,
  WordCloudDatum,
} from '../types'

const DETAIL_LIST_CAP = 100
const GROUP_CAP = 40
const PER_PARTICIPANT_TOP_LIMIT = 15
// How many real messages of context to show before/after a highlighted moment,
// so the user can actually recall the exchange instead of reading it in isolation.
const CONTEXT_WINDOW = 3
// Beyond this many days of history, a day-by-day GitHub-style grid turns into an
// unreadable wall of slivers — switch to a coarser month-by-month view instead.
const MONTH_VIEW_THRESHOLD_DAYS = 100
// The compact card view only shows the most recent months so the card doesn't grow
// huge for a chat with years of history; "Ver más" always shows the full range.
const CARD_MONTH_LIMIT = 10
// Every "which day is this" bucket (streaks, heatmaps, icebreaker, top days, weekday
// radar) treats the day as starting at 6am, not midnight — a 2am message still
// belongs to the night before, which matches how people actually talk about "today."
const DAY_START_HOUR = 6
// The icebreaker only counts a message as a genuine "opener" when the chat had gone
// quiet for at least this long beforehand — otherwise a message sent two minutes
// after midnight-adjacent chatter would wrongly count as restarting the conversation.
const ICEBREAKER_MIN_GAP_HOURS = 3

// Grammatical glue only (articles, pronouns, prepositions, conjunctions, and the most
// common ser/estar/tener/ir/hacer conjugations) — deliberately keeps slang and filler
// words like "boludo", "posta" or "dale" untouched, since those are what makes a word
// cloud interesting. Word-cloud text is matched as-typed, so both accented and
// unaccented spellings need an entry.
const stopWords = new Set([
  // Spanish — articles, pronouns, prepositions, conjunctions
  'a', 'al', 'algo', 'alguien', 'algun', 'algún', 'alguna', 'algunas', 'alguno', 'algunos', 'ante',
  'aqui', 'aquí', 'aquel', 'aquella', 'aquello', 'aquellos', 'aquellas', 'asi', 'así', 'aunque',
  'cada', 'como', 'con', 'cual', 'cuál', 'cuales', 'cuáles', 'cuando', 'cuándo', 'de', 'del',
  'desde', 'donde', 'dónde', 'el', 'él', 'ella', 'ellas', 'ello', 'ellos', 'en', 'entonces',
  'entre', 'era', 'eran', 'eres', 'es', 'esa', 'esas', 'ese', 'eso', 'esos', 'esta', 'está',
  'estaba', 'estaban', 'estamos', 'estan', 'están', 'estas', 'estás', 'este', 'esto', 'estos',
  'estoy', 'fue', 'fueron', 'fui', 'fuimos', 'hace', 'hacia', 'hacía', 'hasta', 'hay', 'igual',
  'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'más', 'me', 'mi', 'mis', 'mucho', 'muchas',
  'muchos', 'muy', 'nada', 'ni', 'ningun', 'ningún', 'ninguna', 'no', 'nos', 'nosotras',
  'nosotros', 'nuestra', 'nuestras', 'nuestro', 'nuestros', 'o', 'os', 'otra', 'otras', 'otro',
  'otros', 'para', 'pero', 'poco', 'pocos', 'por', 'porque', 'porqué', 'pues', 'que', 'qué',
  'quien', 'quién', 'quienes', 'quiénes', 'se', 'sea', 'sean', 'ser', 'si', 'sí', 'sido', 'siendo',
  'sin', 'sobre', 'solo', 'sólo', 'son', 'sos', 'soy', 'su', 'sus', 'tal', 'tambien', 'también', 'tan',
  'tanto', 'te', 'ti', 'tiene', 'tienen', 'toda', 'todas', 'todavia', 'todavía', 'todo', 'todos',
  'tu', 'tú', 'tus', 'un', 'una', 'unas', 'uno', 'unos', 'vos', 'vosotras', 'vosotros', 'ya', 'yo',
  'y',
  // Spanish — first/second person verb forms that show up constantly and add no signal
  'creo', 'digo', 'dijo', 'dice', 'decia', 'decía', 'estabas', 'habia', 'había', 'quiero',
  'queres', 'querés', 'quiere', 'sabes', 'sabés', 'se puede', 'sera', 'será', 'seria', 'sería',
  'tenia', 'tenía', 'vamos', 'van', 'vas', 'voy',
  // English — articles, pronouns, prepositions, conjunctions, common auxiliary verbs
  'a', 'about', 'after', 'again', 'all', 'am', 'an', 'and', 'any', 'are', "aren't", 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'but', 'by', 'can', "can't", 'could', 'did',
  'do', 'does', 'doing', "don't", 'down', 'even', 'every', 'for', 'from', 'get', 'go', 'going',
  'got', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'i', "i'll", "i'm", "i've", 'if', 'in', 'into', 'is', "isn't", 'it', "it's", 'its',
  'itself', 'just', 'll', 'me', 'more', 'most', 'much', 'my', 'myself', 'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 're', 's', 'same', 'she', "she's", 'should', 'so', 'some', 'still', 'such', 'than',
  'that', "that's", 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', "they're", 'this', 'those', 'through', 'to', 'too', 've', 'very', 'was', "wasn't", 'we',
  "we're", 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  "won't", 'would', "wouldn't", 'you', "you're", "you've", 'your', 'yours', 'yourself',
])

const englishTokenHints = new Set([
  'bro', 'cool', 'crush', 'lol', 'match', 'mood', 'random', 'same', 'sorry', 'stress', 'update',
])

// U+0300..U+036F is the Unicode "Combining Diacritical Marks" block that NFD
// normalization splits accents into (built from code points, not a \uXXXX literal,
// to keep the exact range unambiguous).
const combiningMarksPattern = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g')

// Strips accents (á→a, ñ→n, ...) and lowercases, so every dictionary below only needs
// one unaccented spelling per word/phrase instead of every accented variant a phone's
// autocorrect might produce.
function normalizeForMatch(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(combiningMarksPattern, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// `\b` word boundaries around every alternative, so a short word like "bro" or "hot"
// only matches as its own word — never as a slice of "hombro"/"libro" or "hotel".
function toBoundaryPattern(phrases: string[]): RegExp {
  return new RegExp(`\\b(?:${phrases.map(escapeRegExp).join('|')})\\b`, 'i')
}

function buildRepeatedEmojiPattern(emojis: string[], minCount: number): RegExp {
  return new RegExp(`(?:${emojis.map(escapeRegExp).join('|')}){${minCount},}`, 'u')
}

interface RedFlagCategory {
  weight: number
  labelEs: string
  labelEn: string
  pattern: RegExp
}

// Categorized so one ambiguous word (like a plain "perdón"/"sorry") never taints the
// score by itself — each category groups phrases that, together, actually read as a
// real relationship-tension pattern rather than everyday politeness.
const redFlagCategories: RedFlagCategory[] = [
  {
    weight: 4,
    labelEs: 'Celos y control',
    labelEn: 'Jealousy & control',
    pattern: toBoundaryPattern([
      'celos', 'celoso', 'celosa', 'celosito', 'celosita', 'jealous', 'controlador', 'controladora',
      'me controlas', 'manipulador', 'manipuladora', 'manipulacion', 'toxico', 'toxica', 'toxic',
      'no confio en ti', 'no confio en vos', 'no te creo nada', 'no te creo', 'estas mintiendo',
      'me estas mintiendo', 'me estas ignorando', 'me ignoras', 'con quien estas', 'con quien andas',
      'con quien hablabas', 'quien es el', 'quien es ese', 'quien es esa', 'revisa tu celular',
      'revisa tu telefono', 'muestrame tu celular', 'me dejaste en visto', 'me dejas en visto',
      'me tienes en visto', 'me tenes en visto',
    ]),
  },
  {
    weight: 3,
    labelEs: 'Culpa y reproches',
    labelEn: 'Guilt-tripping',
    pattern: toBoundaryPattern([
      'siempre haces lo mismo', 'siempre lo mismo', 'nunca me escuchas', 'nunca estas', 'es tu culpa',
      'todo es tu culpa', 'your fault', 'no te importa nada', "you don't care about me",
      'me tienes abandonada', 'me tienes abandonado', 'me tenes abandonada', 'me tenes abandonado',
    ]),
  },
  {
    weight: 5,
    labelEs: 'Insultos',
    labelEn: 'Insults',
    pattern: toBoundaryPattern([
      'idiota', 'imbecil', 'estupido', 'estupida', 'inutil', 'patetico', 'patetica', 'asqueroso',
      'asquerosa', 'das asco', 'me das asco', 'te odio', 'i hate you', 'sos un desastre',
      'eres un desastre', "you're pathetic", "you're an idiot",
    ]),
  },
  {
    weight: 5,
    labelEs: 'Amenazas de ruptura',
    labelEn: 'Breakup threats',
    pattern: toBoundaryPattern([
      'terminamos', 'se acabo', 'quiero terminar', 'quiero cortar', 'ya no te quiero', 'ya no te amo',
      'no te amo mas', 'romper contigo', 'no quiero verte mas', 'no quiero saber nada de ti',
      'no quiero saber nada de vos', 'breaking up with you', "we're done", "i'm done with you",
    ]),
  },
]

function categoryLabel(category: RedFlagCategory, language: Language): string {
  return language === 'es' ? category.labelEs : category.labelEn
}

// Actually cringe-coded phrases (dated slang, over-the-top pet names, roleplay-style
// asterisk actions) — deliberately excludes ordinary, extremely common words like
// "literal" or "bro" that used to swamp this metric with false positives.
const cringeWords = [
  'uwu', 'owo', 'senpai', 'kawaii', 'nyaa', 'shippear', 'shipear', 'bebito', 'bebita', 'bb', 'bby',
  'amorsh', 'amoxis', 'mi cielito', 'mi principito', 'mi princesa', 'mi rey', 'mi reina', 'papucho',
  'papuchi', 'mamacita', 'te amo infinito', 'te amo con toda mi alma', 'eres mi todo', 'sos mi todo',
  'no puedo vivir sin ti', 'no puedo vivir sin vos', 'mi media naranja', 'almas gemelas', 'yolo',
  'swag', 'ntc',
]
const cringePattern = toBoundaryPattern(cringeWords)
// "*se sonroja*", "*te abraza*" — roleplay-style narrated actions are a strong, distinct
// cringe signal on their own, independent of the word dictionary above.
const roleplayActionPattern = /\*[^*\n]{2,40}\*/
const cutesySpamPattern = buildRepeatedEmojiPattern(
  ['❤️', '❤', '🥺', '😍', '🥰', '💕', '💖', '💗', '😻', '💞', '💓'],
  3,
)

// Heuristic list for "El Tono Picante" — a configurable dictionary,
// not a claim of accuracy. Easy to extend without touching the scoring logic.
const flirtyWords = [
  'caliente', 'calentura', 'sexy', 'sexi', 'seductor', 'seductora', 'tentador',
  'tentadora', 'provocador', 'provocadora', 'provocando', 'ardiente', 'sensual', 'morbo', 'pasion',
  'apasionado', 'apasionada', 'travieso', 'traviesa', 'gemir', 'gemidos', 'erotico', 'erotica',
  'desnudo', 'desnuda', 'desnudarte', 'desnudarme', 'me calentas', 'me prendes', 'caliente',
  'ganas de vos', 'ganas de ti', 'fantasia', 'fantasias', 'hot', 'turned on', 'sexting', 'flirty',
  'naughty', 'teasing', 'pene', 'pija', 'verga', 'polla', 'chota', 'dick', 'cock', 'sprick', 'schlong', 'shaft', 
  'culo', 'orto', 'nalgas', 'pompis', 'ass', 'butt', 'botty', 'teta', 'tetas', 'pecho', 'pechos', 'boob', 'boobs', 'tit', 'tits', 'breast',
  'breasts', 'knockers', 'jugs', 'vagina', 'concha', 'coño', 'sexo', 'pussy', 'cunt', 'snatch', 'twat', 'beaver', 'muff', 'puta', 'slut'
]
const flirtyPattern = toBoundaryPattern(flirtyWords)
const flirtyWordPatterns = flirtyWords.map((word) => ({
  word,
  pattern: new RegExp(`\\b${escapeRegExp(word)}\\b`),
}))

const weekdayLabels: Record<Language, string[]> = {
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

interface MetricMeta {
  title: string
  description: string
  preview: string
}

type MetaDictionary = Record<string, Record<Language, MetricMeta>>

const metricMeta: MetaDictionary = {
  spammer: {
    es: { title: 'El Spammer vs El Silencioso', description: 'Qué porcentaje del chat aporta cada participante.', preview: 'Reparto por integrante y cómo cambió mes a mes.' },
    en: { title: 'Spammer vs The Quiet One', description: 'How much of the chat each participant contributes.', preview: 'Per-participant split and how it shifted month by month.' },
  },
  monologuista: {
    es: { title: 'El Monologuista', description: 'La racha más larga de mensajes seguidos sin respuesta.', preview: 'Ranking de rachas y los bloques literales de cada una.' },
    en: { title: 'The Monologuist', description: 'The longest streak of messages sent without a reply.', preview: 'Streak ranking and the literal blocks behind each one.' },
  },
  reloj: {
    es: { title: 'El Reloj Biológico', description: 'A qué hora del día vive este chat.', preview: 'Heatmap horario individual de cada integrante.' },
    en: { title: 'The Body Clock', description: 'What time of day this chat comes alive.', preview: "Each participant's own hourly heatmap." },
  },
  rompehielo: {
    es: { title: 'El Rompehielo', description: 'Quién arranca la conversación la mayoría de los días.', preview: 'Porcentajes de apertura y el primer mensaje de cada día.' },
    en: { title: 'The Icebreaker', description: 'Who starts the conversation on most days.', preview: "Opening percentages and each day's first message." },
  },
  emojis: {
    es: { title: 'Guerra de Emojis', description: 'Los emojis que más se repiten en el chat.', preview: 'Top personal de emojis de cada integrante.' },
    en: { title: 'Emoji Wars', description: 'The emojis that show up the most in the chat.', preview: "Each participant's personal emoji top." },
  },
  'racha-dias': {
    es: { title: 'Días de Racha', description: 'Cuántos días seguidos hubo al menos un mensaje.', preview: 'Calendario de rachas y quién más participó en ellas.' },
    en: { title: 'Daily Streak', description: 'How many days in a row had at least one message.', preview: 'Streak calendar and who carried each one.' },
  },
  testamento: {
    es: { title: 'El Testamento', description: 'El mensaje con más caracteres de todo el chat.', preview: 'Top 10 de mensajes más largos por integrante.' },
    en: { title: 'The Testament', description: 'The message with the most characters in the whole chat.', preview: "Each participant's top 10 longest messages." },
  },
  multimedia: {
    es: { title: 'El Fan de la Multimedia', description: 'Quién manda más fotos, videos y audios.', preview: 'Línea de tiempo de los días con más envíos.' },
    en: { title: 'The Multimedia Fan', description: 'Who sends the most photos, videos, and voice notes.', preview: 'Timeline of the days with the biggest media spikes.' },
  },
  'top-dias': {
    es: { title: 'El Mes Más Intenso', description: 'El día con más mensajes en toda la historia del chat.', preview: 'Top 10 de días pico y quién los empujó.' },
    en: { title: 'Most Intense Day', description: 'The single busiest day in the whole chat history.', preview: 'Top 10 peak days and who drove them.' },
  },
  velocista: {
    es: { title: 'El Velocista', description: 'Quién escribe los mensajes más cortos en promedio.', preview: 'Histograma de mensajes cortos, medios y largos.' },
    en: { title: 'The Speedster', description: 'Who writes the shortest messages on average.', preview: 'Histogram of short, medium, and long messages.' },
  },
  'heatmap-anual': {
    es: { title: 'Heatmap Anual', description: 'Los días de mayor actividad de todo el año, estilo GitHub.', preview: 'Un heatmap propio para cada integrante.' },
    en: { title: 'Yearly Heatmap', description: "The whole year's busiest days, GitHub-contributions style.", preview: "Each participant's own heatmap." },
  },
  termometro: {
    es: { title: 'Termómetro Semanal', description: 'Qué día de la semana concentra más mensajes.', preview: 'Radar semanal individual de cada integrante.' },
    en: { title: 'Weekly Thermometer', description: 'Which weekday carries the most messages.', preview: "Each participant's own weekly radar." },
  },
  clavavistos: {
    es: { title: 'El Clavavistos', description: 'Quién tarda más en responder cuando le escriben.', preview: 'Historial completo de las peores demoras, con fecha y mensaje.' },
    en: { title: 'Seen-Zone Champion', description: 'Who takes the longest to reply when messaged.', preview: 'Full history of the worst delays, with date and message.' },
  },
  inactividad: {
    es: { title: 'Rachas de Inactividad', description: 'Los silencios más largos de toda la conversación.', preview: 'Cronología de silencios y quién rompió el hielo cada vez.' },
    en: { title: 'Inactivity Streaks', description: 'The longest silences in the whole conversation.', preview: 'Chronology of silences and who broke the ice each time.' },
  },
  wordcloud: {
    es: { title: 'Nube de Palabras Avanzada', description: 'El vocabulario más repetido, sin artículos ni muletillas.', preview: 'Nube personal y buscador por integrante.' },
    en: { title: 'Advanced Word Cloud', description: 'The most repeated vocabulary, filtered of filler words.', preview: 'Personal cloud and search per participant.' },
  },
  redflags: {
    es: { title: 'Detector de Red Flags', description: 'Un puntaje de tensión a partir de silencios, borrados y palabras clave.', preview: 'Desglose de patrones y momentos señalados.' },
    en: { title: 'Red Flag Detector', description: 'A tension score built from silences, deletions, and keywords.', preview: 'Pattern breakdown and flagged moments.' },
  },
  cringe: {
    es: { title: 'Índice de Cringe', description: 'Cuántas veces aparece vocabulario marcado como cringe.', preview: 'Top 5 momentos cringe por integrante, con fecha y frase.' },
    en: { title: 'Cringe Index', description: 'How often cringe-flagged vocabulary shows up.', preview: "Each participant's top 5 cringe moments, dated and quoted." },
  },
  arrepentido: {
    es: { title: 'El Arrepentido', description: 'Cuántos mensajes borró cada quien después de mandarlos.', preview: 'Evolución de los borrados a lo largo del tiempo.' },
    en: { title: 'The Regret Counter', description: 'How many messages each person deleted after sending.', preview: 'How deletions evolved over time.' },
  },
  poliglota: {
    es: { title: 'El Políglota', description: 'Quién mezcla más inglés y anglicismos en la charla.', preview: 'Términos importados favoritos de cada integrante.' },
    en: { title: 'The Polyglot', description: 'Who mixes in the most English and imported terms.', preview: "Each participant's favorite imported terms." },
  },
  jajaja: {
    es: { title: 'El Jajaja Analítico', description: 'El estilo de risa que domina el chat.', preview: 'Distribución de estilos de risa por integrante.' },
    en: { title: 'The Laugh Analyzer', description: 'The laugh style that dominates the chat.', preview: "Each participant's laugh-style breakdown." },
  },
  metralleta: {
    es: { title: 'El Metralleta', description: 'Quién fragmenta una idea en ráfagas de mensajes cortos.', preview: 'Los combos más grandes, con el bloque literal.' },
    en: { title: 'The Machine Gun', description: 'Who breaks one thought into a burst of tiny messages.', preview: 'The biggest combos, with the literal block.' },
  },
  interrogador: {
    es: { title: 'El Interrogador', description: 'Quién pregunta más en proporción al resto del grupo.', preview: 'Reparto de preguntas por integrante.' },
    en: { title: 'The Interrogator', description: 'Who asks the most, relative to the rest of the group.', preview: 'Question share by participant.' },
  },
  dramatico: {
    es: { title: 'El Dramático', description: 'Quién manda más mensajes enteramente en MAYÚSCULAS.', preview: 'Top 3 de mensajes más gritados por integrante.' },
    en: { title: 'The Dramatic One', description: 'Who sends the most messages entirely in ALL CAPS.', preview: "Each participant's top 3 loudest messages." },
  },
  tonopicante: {
    es: { title: 'El Tono Picante', description: 'Quién manda más mensajes subidos de tono (+18, heurístico).', preview: 'Horarios preferidos, palabras más usadas y los mensajes exactos.' },
    en: { title: 'The Spicy Tone', description: 'Who sends the most suggestive messages (+18, heuristic).', preview: 'Preferred hours, the most used words, and the exact messages.' },
  },
  curador: {
    es: { title: 'El Curador de Contenidos', description: 'Quién comparte más links de YouTube, TikTok y redes.', preview: 'Categorías de contenido compartidas por integrante.' },
    en: { title: 'The Content Curator', description: 'Who shares the most YouTube, TikTok, and social links.', preview: "Content categories shared by each participant." },
  },
}

interface MetricResult {
  hasData: boolean
  basic?: MetricStat
  detail?: MetricDetail
}

interface MetricContext {
  chatMessages: ChatMessage[]
  textMessages: ChatMessage[]
  participants: string[]
  language: Language
  /** Position of each message (by id) within `chatMessages` — lets any metric find
   * the real message right before/after a highlighted moment, for context. */
  messageIndex: Map<string, number>
}

/** Hands control back to the browser for a tick. A chat with 100k+ messages can
 * take a few seconds of pure CPU work to analyze; splitting that into a couple of
 * yielded chunks (see buildAnalysis) keeps the tab responsive — and Chrome from
 * offering to kill it — instead of one long uninterrupted block. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function buildAnalysis(
  chatName: string,
  messages: ChatMessage[],
  language: Language,
  hasVipAccess: boolean,
  sourceHash: string,
): Promise<AnalysisBundle> {
  const chatMessages = messages.filter((message) => !message.isSystem && message.sender)
  const textMessages = chatMessages.filter((message) => !message.isSystemPlaceholder)
  const participants = [...new Set(chatMessages.map((message) => message.sender as string))]
  const firstMessage = chatMessages[0]
  const lastMessage = chatMessages.at(-1)

  if (chatMessages.length === 0) {
    return {
      chatName,
      dateRangeLabel: language === 'es' ? 'Sin datos suficientes' : 'Not enough data',
      generatedAt: new Date().toISOString(),
      messageCount: 0,
      participantCount: 0,
      participants: [],
      sourceHash,
      freeMetrics: [],
      vipMetrics: [],
    }
  }

  const messageIndex = new Map(chatMessages.map((message, index) => [message.id, index]))
  const ctx: MetricContext = { chatMessages, textMessages, participants, language, messageIndex }

  const freeMetrics = buildFreeMetrics(ctx, hasVipAccess).filter((card) => card.hasData)
  await yieldToBrowser()
  const vipMetrics = buildVipMetrics(ctx, hasVipAccess).filter((card) => card.hasData)

  return {
    chatName,
    dateRangeLabel: `${formatDate(firstMessage.timestamp, language)} - ${formatDate(lastMessage!.timestamp, language)}`,
    generatedAt: new Date().toISOString(),
    messageCount: chatMessages.length,
    participantCount: participants.length,
    participants,
    sourceHash,
    freeMetrics,
    vipMetrics,
  }
}

function buildFreeMetrics(ctx: MetricContext, hasVipAccess: boolean): MetricCard[] {
  const { language } = ctx
  return [
    createMetric('spammer', language, 'free', 'tier-purple', metricSpammer(ctx), hasVipAccess),
    createMetric('monologuista', language, 'free', 'tier-pink', metricMonologuista(ctx), hasVipAccess),
    createMetric('reloj', language, 'free', 'tier-orange', metricReloj(ctx), hasVipAccess),
    createMetric('rompehielo', language, 'free', 'tier-blue', metricRompehielo(ctx), hasVipAccess),
    createMetric('emojis', language, 'free', 'tier-cyan', metricEmojis(ctx), hasVipAccess),
    createMetric('racha-dias', language, 'free', 'tier-lime', metricRachaDias(ctx), hasVipAccess),
    createMetric('testamento', language, 'free', 'tier-gold', metricTestamento(ctx), hasVipAccess),
    createMetric('multimedia', language, 'free', 'tier-rose', metricMultimedia(ctx), hasVipAccess),
    createMetric('top-dias', language, 'free', 'tier-indigo', metricTopDias(ctx), hasVipAccess),
    createMetric('velocista', language, 'free', 'tier-mint', metricVelocista(ctx), hasVipAccess),
    createMetric('heatmap-anual', language, 'free', 'tier-teal', metricHeatmapAnual(ctx), hasVipAccess),
    createMetric('termometro', language, 'free', 'tier-violet', metricTermometro(ctx), hasVipAccess),
  ]
}

function buildVipMetrics(ctx: MetricContext, hasVipAccess: boolean): MetricCard[] {
  const { language } = ctx
  return [
    createMetric('clavavistos', language, 'vip', 'tier-purple', metricClavavistos(ctx), hasVipAccess),
    createMetric('inactividad', language, 'vip', 'tier-slate', metricInactividad(ctx), hasVipAccess),
    createMetric('wordcloud', language, 'vip', 'tier-cyan', metricWordcloud(ctx), hasVipAccess),
    createMetric('redflags', language, 'vip', 'tier-red', metricRedflags(ctx), hasVipAccess),
    createMetric('cringe', language, 'vip', 'tier-orange', metricCringe(ctx), hasVipAccess),
    createMetric('arrepentido', language, 'vip', 'tier-rose', metricArrepentido(ctx), hasVipAccess),
    createMetric('poliglota', language, 'vip', 'tier-green', metricPoliglota(ctx), hasVipAccess),
    createMetric('jajaja', language, 'vip', 'tier-yellow', metricJajaja(ctx), hasVipAccess),
    createMetric('metralleta', language, 'vip', 'tier-blue', metricMetralleta(ctx), hasVipAccess),
    createMetric('interrogador', language, 'vip', 'tier-indigo', metricInterrogador(ctx), hasVipAccess),
    createMetric('dramatico', language, 'vip', 'tier-gold', metricDramatico(ctx), hasVipAccess),
    createMetric('tonopicante', language, 'vip', 'tier-magenta', metricTonoPicante(ctx), hasVipAccess),
    createMetric('curador', language, 'vip', 'tier-sky', metricCurador(ctx), hasVipAccess),
  ]
}

function createMetric(
  id: string,
  language: Language,
  tier: 'free' | 'vip',
  accent: string,
  result: MetricResult,
  hasVipAccess: boolean,
): MetricCard {
  const meta = metricMeta[id]?.[language]

  if (!meta) {
    throw new Error(`Missing metric metadata for "${id}" in language "${language}".`)
  }

  const basicLocked = tier === 'vip' && !hasVipAccess
  const detailLocked = !hasVipAccess

  return {
    id,
    title: meta.title,
    description: meta.description,
    tier,
    accent,
    hasData: result.hasData,
    basic: basicLocked ? undefined : result.basic,
    detail: detailLocked ? undefined : result.detail,
    preview: meta.preview,
  }
}

// ---------------------------------------------------------------------------
// Free metrics
// ---------------------------------------------------------------------------

function metricSpammer(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const bySender = countBySender(chatMessages)
  const total = chatMessages.length
  const top = topEntry(bySender)

  if (!top) {
    return { hasData: false }
  }

  return {
    hasData: true,
    basic: {
      value: percentage(top.value, total),
      label: language === 'es' ? `de los mensajes son de ${top.key}` : `of all messages are from ${top.key}`,
      chart: { kind: 'bar', items: rankingPercentBars(bySender, total, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Reparto de la conversación y cómo cambió el ritmo mes a mes.'
          : 'How the conversation splits up, and how its pace shifted month by month.',
      chart: { kind: 'timeline', points: monthlyVolume(chatMessages, language) },
      breakdown: breakdownPercent(bySender, total),
    },
  }
}

function metricMonologuista(ctx: MetricContext): MetricResult {
  // textMessages (not chatMessages) so a burst of media placeholders — photos,
  // voice notes — never counts as "monologuing"; only actual authored text does.
  const { textMessages, language } = ctx
  const blocks = getStreakBlocks(textMessages)
  const top = blocks[0]

  if (!top) {
    return { hasData: false }
  }

  const bySender = maxStreakBySender(blocks)

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.count, language),
      label:
        language === 'es'
          ? `mensajes seguidos de ${top.sender} sin respuesta`
          : `messages in a row from ${top.sender} with no reply`,
      note: top.texts[0] ? `"${truncate(top.texts[0], 90)}"` : undefined,
      chart: { kind: 'bar', items: rankingBars(bySender, language, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Rachas más largas de mensajes seguidos, por integrante.'
          : 'Longest back-to-back message streaks, by participant.',
      breakdown: breakdownCount(bySender, language),
      groups: capGroups(
        blocks.map((block) => rangeGroup(ctx, block.startMessage, block.endMessage, streakHeading(block, language))),
      ),
      paginatedItemsLabel: language === 'es' ? 'Bloques de mensajes seguidos' : 'Back-to-back message blocks',
    },
  }
}

function metricReloj(ctx: MetricContext): MetricResult {
  const { chatMessages, participants, language } = ctx

  if (chatMessages.length === 0) {
    return { hasData: false }
  }

  const hours = hourBuckets(chatMessages)
  const owls = sumRange(hours, [22, 23, 0, 1, 2, 3, 4])
  const earlyBirds = sumRange(hours, [6, 7, 8, 9, 10, 11])
  const isOwl = owls >= earlyBirds

  const series: MetricSeriesEntry[] = participants.map((name) => ({
    name,
    chart: { kind: 'hourHeatmap', hours: hourBuckets(chatMessages.filter((message) => message.sender === name)) },
  }))

  return {
    hasData: true,
    basic: {
      value: isOwl ? (language === 'es' ? 'Búhos' : 'Night owls') : language === 'es' ? 'Madrugadores' : 'Early birds',
      label: isOwl
        ? language === 'es'
          ? `${owls} mensajes de madrugada o noche`
          : `${owls} late-night messages`
        : language === 'es'
          ? `${earlyBirds} mensajes matutinos`
          : `${earlyBirds} morning messages`,
      chart: { kind: 'hourHeatmap', hours },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Actividad hora por hora, con un heatmap propio para cada integrante.'
          : "Hour-by-hour activity, with each participant's own heatmap.",
      series,
    },
  }
}

function metricRompehielo(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const openers = getDayOpeners(chatMessages)
  const byStarter = countBySender(openers)
  const top = topEntry(byStarter)

  if (!top) {
    return { hasData: false }
  }

  const total = openers.length

  return {
    hasData: true,
    basic: {
      value: percentage(top.value, total),
      label: language === 'es' ? `de los días los abre ${top.key}` : `of days are opened by ${top.key}`,
      chart: { kind: 'donut', items: [...byStarter.entries()].map(([label, value]) => ({ label, value })) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Quién retoma la charla cada día, con el primer mensaje exacto.'
          : 'Who restarts the conversation each day, with the exact opening message.',
      breakdown: breakdownPercent(byStarter, total),
      groups: capGroups(
        openers.map((message) =>
          momentGroup(
            ctx,
            message,
            language === 'es'
              ? `${formatDate(message.timestamp, language)} — abrió ${message.sender}`
              : `${formatDate(message.timestamp, language)} — opened by ${message.sender}`,
          ),
        ),
      ),
      paginatedItemsLabel: language === 'es' ? 'Aperturas de conversación' : 'Conversation openers',
    },
  }
}

function metricEmojis(ctx: MetricContext): MetricResult {
  const { chatMessages, participants, language } = ctx
  const overall = getEmojiCounts(chatMessages)

  if (overall.size === 0) {
    return { hasData: false }
  }

  const topOverall = [...overall.entries()].sort((left, right) => right[1] - left[1])
  const breakdown: ParticipantBreakdownEntry[] = []
  const series: MetricSeriesEntry[] = []

  for (const name of participants) {
    const personal = [...getEmojiCounts(chatMessages.filter((message) => message.sender === name)).entries()].sort(
      (left, right) => right[1] - left[1],
    )

    if (personal.length === 0) {
      continue
    }

    breakdown.push({ name, value: personal[0][1], displayValue: `${personal[0][0]} ×${personal[0][1]}` })
    series.push({
      name,
      chart: {
        kind: 'bar',
        items: personal
          .slice(0, PER_PARTICIPANT_TOP_LIMIT)
          .map(([emoji, count]) => ({ label: emoji, value: count, displayValue: `×${formatNumber(count, language)}` })),
      },
    })
  }

  return {
    hasData: true,
    basic: {
      value: `${topOverall[0][0]} ×${formatNumber(topOverall[0][1], language)}`,
      label: language === 'es' ? 'el emoji favorito del chat' : "the chat's favorite emoji",
      chart: {
        kind: 'bar',
        items: topOverall.slice(0, 5).map(([emoji, count]) => ({ label: emoji, value: count, displayValue: `×${formatNumber(count, language)}` })),
      },
    },
    detail: {
      intro:
        language === 'es'
          ? `Top ${PER_PARTICIPANT_TOP_LIMIT} de emojis por integrante.`
          : `Top ${PER_PARTICIPANT_TOP_LIMIT} emojis per participant.`,
      breakdown,
      series,
    },
  }
}

function metricRachaDias(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const streaks = getDailyStreaks(chatMessages)

  if (streaks.length === 0) {
    return { hasData: false }
  }

  const longest = streaks[0]
  const topStreaks = streaks.slice(0, 8)
  const participation = getStreakParticipation(chatMessages, topStreaks)
  const total = [...participation.values()].reduce((sum, value) => sum + value, 0)

  const streakRanges: StreakRange[] = topStreaks.map((streak) => ({
    startLabel: formatDate(streak.startIso, language),
    endLabel: formatDate(streak.endIso, language),
    days: streak.days,
  }))

  return {
    hasData: true,
    basic: {
      value: formatNumber(longest.days, language),
      label: language === 'es' ? 'días seguidos con al menos un mensaje' : 'days in a row with at least one message',
    },
    detail: {
      intro:
        language === 'es'
          ? 'Las rachas más largas de días activos, y quién más aportó en ellas.'
          : 'The longest active-day streaks, and who carried them most.',
      chart: { kind: 'calendarStreak', streaks: streakRanges },
      breakdown: total > 0 ? breakdownPercent(participation, total) : undefined,
    },
  }
}

function metricTestamento(ctx: MetricContext): MetricResult {
  const { textMessages, participants, language } = ctx
  const withContent = textMessages.filter((message) => message.contentText.length > 0)

  if (withContent.length === 0) {
    return { hasData: false }
  }

  const longest = [...withContent].sort((left, right) => right.contentText.length - left.contentText.length)[0]
  const breakdown: ParticipantBreakdownEntry[] = []
  const allTop: { name: string; message: ChatMessage }[] = []

  for (const name of participants) {
    const own = withContent
      .filter((message) => message.sender === name)
      .sort((left, right) => right.contentText.length - left.contentText.length)
      .slice(0, 10)

    if (own.length === 0) {
      continue
    }

    breakdown.push({
      name,
      value: own[0].contentText.length,
      displayValue:
        language === 'es'
          ? `${formatNumber(own[0].contentText.length, language)} caracteres`
          : `${formatNumber(own[0].contentText.length, language)} characters`,
    })

    for (const message of own) {
      allTop.push({ name, message })
    }
  }

  allTop.sort((left, right) => right.message.contentText.length - left.message.contentText.length)
  breakdown.sort((left, right) => right.value - left.value)

  return {
    hasData: true,
    basic: {
      value: formatNumber(longest.contentText.length, language),
      label:
        language === 'es'
          ? `caracteres en el mensaje más largo, de ${longest.sender}`
          : `characters in the longest message, from ${longest.sender}`,
      note: `"${truncate(longest.contentText, 140)}"`,
    },
    detail: {
      intro: language === 'es' ? 'Los mensajes más extensos de cada integrante.' : "Each participant's longest messages.",
      breakdown,
      groups: capGroups(
        allTop.map((item) =>
          momentGroup(
            ctx,
            item.message,
            language === 'es'
              ? `${item.name} — ${formatNumber(item.message.wordCount, language)} palabras, ${formatNumber(item.message.contentText.length, language)} caracteres`
              : `${item.name} — ${formatNumber(item.message.wordCount, language)} words, ${formatNumber(item.message.contentText.length, language)} characters`,
          ),
        ),
      ),
      paginatedItemsLabel: language === 'es' ? 'Mensajes más largos' : 'Longest messages',
    },
  }
}

function metricMultimedia(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const mediaMessages = chatMessages.filter((message) => message.isMedia)
  const bySender = countBySender(mediaMessages)
  const top = topEntry(bySender)

  if (!top) {
    return { hasData: false }
  }

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.value, language),
      label: language === 'es' ? `archivos multimedia enviados por ${top.key}` : `media files sent by ${top.key}`,
      chart: { kind: 'bar', items: rankingBars(bySender, language, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Los días con más ráfagas de fotos, videos y audios.'
          : 'The days with the biggest bursts of photos, videos, and voice notes.',
      chart: { kind: 'timeline', points: dailyVolume(mediaMessages, language) },
      breakdown: breakdownPercent(bySender, mediaMessages.length),
    },
  }
}

function metricTopDias(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const byDay = countByDay(chatMessages)

  if (byDay.size === 0) {
    return { hasData: false }
  }

  const sorted = [...byDay.entries()].sort((left, right) => right[1] - left[1])
  const [topDay, topCount] = sorted[0]
  const top10 = sorted.slice(0, 10)
  const bySenderOnTopDay = countBySender(chatMessages.filter((message) => dayKey(message.timestamp) === topDay))

  return {
    hasData: true,
    basic: {
      value: formatNumber(topCount, language),
      label: language === 'es' ? `mensajes el ${formatDate(topDay, language)}` : `messages on ${formatDate(topDay, language)}`,
    },
    detail: {
      intro:
        language === 'es'
          ? 'Los 10 días con más actividad histórica, y quién los empujó.'
          : 'The 10 most active days in history, and who drove them.',
      chart: {
        kind: 'bar',
        items: top10.map(([day, count]) => ({ label: formatDate(day, language), value: count, displayValue: formatNumber(count, language) })),
      },
      breakdown: breakdownCount(bySenderOnTopDay, language),
      groups: capGroups(
        top10
          .map(([day, count]) =>
            dayRangeGroup(
              ctx,
              day,
              language === 'es'
                ? `${formatDate(day, language)} — pico de ${formatNumber(count, language)} mensajes`
                : `${formatDate(day, language)} — peak of ${formatNumber(count, language)} messages`,
            ),
          )
          .filter((group): group is MessageGroup => group !== null),
      ),
      paginatedItemsLabel: language === 'es' ? 'Fragmentos de los días pico' : 'Peak-day fragments',
    },
  }
}

function metricVelocista(ctx: MetricContext): MetricResult {
  const { textMessages, participants, language } = ctx
  const stats = getWordAverages(textMessages)

  if (stats.length === 0) {
    return { hasData: false }
  }

  const winner = stats[0]
  const buckets = getLengthBuckets(textMessages, language)
  const series: MetricSeriesEntry[] = participants
    .map((name) => ({
      name,
      chart: getLengthBuckets(
        textMessages.filter((message) => message.sender === name),
        language,
      ),
    }))
    .filter((entry) => entry.chart.some((bucket) => bucket.value > 0))
    .map((entry) => ({ name: entry.name, chart: { kind: 'histogram', buckets: entry.chart } as ChartData }))

  return {
    hasData: true,
    basic: {
      value: winner.average.toFixed(1),
      label:
        language === 'es'
          ? `palabras promedio por mensaje de ${winner.sender}`
          : `average words per message from ${winner.sender}`,
    },
    detail: {
      intro:
        language === 'es'
          ? 'Cómo se reparten los mensajes cortos, medios y largos de cada integrante.'
          : "How each participant's short, medium, and long messages break down.",
      chart: { kind: 'histogram', buckets },
      breakdown: stats.map((item) => ({
        name: item.sender,
        value: Number(item.average.toFixed(1)),
        displayValue: language === 'es' ? `${item.average.toFixed(1)} palabras` : `${item.average.toFixed(1)} words`,
      })),
      series,
    },
  }
}

function metricHeatmapAnual(ctx: MetricContext): MetricResult {
  const { chatMessages, participants, language } = ctx
  const days = getCalendarDays(chatMessages)

  if (days.length === 0) {
    return { hasData: false }
  }

  const top = [...days].sort((left, right) => right.count - left.count)[0]
  const activeDaysBySender = new Map<string, number>()

  for (const name of participants) {
    const ownDays = new Set(
      chatMessages.filter((message) => message.sender === name).map((message) => dayKey(message.timestamp)),
    )
    activeDaysBySender.set(name, ownDays.size)
  }

  // A day-by-day GitHub-style grid stops being readable once a chat spans several
  // months — switch to a month-by-month view instead so it stays legible at a glance.
  const useMonths = daySpan(days) > MONTH_VIEW_THRESHOLD_DAYS
  const monthRange = useMonths ? monthRangeOf(chatMessages) : null

  const chartFor = (messages: ChatMessage[], compact: boolean): ChartData => {
    if (useMonths && monthRange) {
      const months = monthlyCounts(messages, monthRange, language)
      return { kind: 'monthHeatmap', months: compact ? truncateMonths(months) : months }
    }
    return { kind: 'yearHeatmap', days: getCalendarDays(messages) }
  }

  const series: MetricSeriesEntry[] = participants.map((name) => ({
    name,
    chart: chartFor(
      chatMessages.filter((message) => message.sender === name),
      false,
    ),
  }))

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.count, language),
      label:
        language === 'es'
          ? `mensajes en el día más activo (${formatDate(top.date, language)})`
          : `messages on the most active day (${formatDate(top.date, language)})`,
      // The card stays compact (recent months only) even for years of history —
      // the full range is always one tap away in "Ver más".
      chart: chartFor(chatMessages, true),
    },
    detail: {
      intro:
        language === 'es'
          ? 'El mapa de calor completo, y el propio de cada integrante para comparar quién lideró cada época.'
          : "The full heatmap, plus each participant's own to compare who led the chat in different stretches.",
      chart: chartFor(chatMessages, false),
      breakdown: [...activeDaysBySender.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([name, value]) => ({
          name,
          value,
          displayValue:
            language === 'es' ? `${formatNumber(value, language)} días activos` : `${formatNumber(value, language)} active days`,
        })),
      series,
    },
  }
}

function metricTermometro(ctx: MetricContext): MetricResult {
  const { chatMessages, participants, language } = ctx
  const overall = getWeekdayCounts(chatMessages, language)

  if (overall.every((axis) => axis.value === 0)) {
    return { hasData: false }
  }

  const top = [...overall].sort((left, right) => right.value - left.value)[0]
  const topBySender = participants.map((name) => {
    const axes = getWeekdayCounts(
      chatMessages.filter((message) => message.sender === name),
      language,
    )
    const best = [...axes].sort((left, right) => right.value - left.value)[0]
    return { name, best }
  })

  const series: MetricSeriesEntry[] = participants.map((name) => ({
    name,
    chart: { kind: 'radar', axes: getWeekdayCounts(chatMessages.filter((message) => message.sender === name), language) },
  }))

  return {
    hasData: true,
    basic: {
      value: top.axis,
      label: language === 'es' ? 'el día de la semana con más mensajes' : 'the weekday with the most messages',
      chart: { kind: 'radar', axes: overall },
    },
    detail: {
      intro: language === 'es' ? 'La distribución semanal de cada integrante.' : "Each participant's own weekly rhythm.",
      breakdown: topBySender.map(({ name, best }) => ({ name, value: best.value, displayValue: best.axis })),
      series,
    },
  }
}

// ---------------------------------------------------------------------------
// VIP metrics
// ---------------------------------------------------------------------------

function metricClavavistos(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const events = getResponseEvents(chatMessages)

  if (events.length === 0) {
    return { hasData: false }
  }

  const perSender = new Map<string, number[]>()
  for (const event of events) {
    const list = perSender.get(event.sender) ?? []
    list.push(event.minutes)
    perSender.set(event.sender, list)
  }

  const averages = [...perSender.entries()]
    .map(([sender, values]) => ({ sender, average: values.reduce((sum, value) => sum + value, 0) / values.length }))
    .sort((left, right) => right.average - left.average)

  const worst = [...events].sort((left, right) => right.minutes - left.minutes)[0]
  const sortedEvents = [...events].sort((left, right) => right.minutes - left.minutes)

  return {
    hasData: true,
    basic: {
      value: formatDurationMinutes(averages[0].average, language),
      label: language === 'es' ? `tiempo promedio de respuesta de ${averages[0].sender}` : `average reply time from ${averages[0].sender}`,
      note:
        language === 'es'
          ? `Peor demora: ${worst.sender} tardó ${formatDurationMinutes(worst.minutes, language)}.`
          : `Worst gap: ${worst.sender} took ${formatDurationMinutes(worst.minutes, language)}.`,
      chart: {
        kind: 'bar',
        items: averages
          .slice(0, 8)
          .map((item) => ({ label: item.sender, value: item.average, displayValue: formatDurationMinutes(item.average, language) })),
      },
    },
    detail: {
      intro:
        language === 'es'
          ? 'El historial completo de las peores demoras, con fecha, hora y el mensaje ignorado.'
          : 'The full history of the worst reply delays, with date, time, and the ignored message.',
      breakdown: averages.map((item) => ({
        name: item.sender,
        value: Number(item.average.toFixed(1)),
        displayValue: formatDurationMinutes(item.average, language),
      })),
      groups: capGroups(sortedEvents.map((event) => momentGroup(ctx, event.replyMessage, delayHeading(event, language)))),
      paginatedItemsLabel: language === 'es' ? 'Peores demoras' : 'Worst delays',
    },
  }
}

function metricInactividad(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const gaps = getGaps(chatMessages)

  if (gaps.length === 0) {
    return { hasData: false }
  }

  const longest = [...gaps].sort((left, right) => right.hours - left.hours)[0]
  const longSilences = gaps.filter((gap) => gap.hours >= 48).sort((left, right) => right.hours - left.hours)
  const iceBreakers = countBySender(longSilences.map((gap) => gap.after))
  const totalBreaks = [...iceBreakers.values()].reduce((sum, value) => sum + value, 0)

  return {
    hasData: true,
    basic: {
      value: formatDurationHours(longest.hours, language),
      label: language === 'es' ? "fue el silencio más largo del chat" : "was the chat's longest silence",
    },
    detail: {
      intro:
        language === 'es'
          ? 'Todos los silencios de más de 48 horas, y quién rompió el hielo cada vez.'
          : 'Every silence longer than 48 hours, and who broke the ice each time.',
      chart:
        longSilences.length > 0
          ? {
              kind: 'timeline',
              points: longSilences
                .slice(0, 40)
                .reverse()
                .map((gap) => ({
                  dateLabel: formatDate(gap.before.timestamp, language),
                  label: formatDurationHours(gap.hours, language),
                  value: gap.hours,
                })),
            }
          : undefined,
      breakdown: totalBreaks > 0 ? breakdownPercent(iceBreakers, totalBreaks) : undefined,
      groups: capGroups(longSilences.map((gap) => momentGroup(ctx, gap.after, silenceHeading(gap, language)))),
      paginatedItemsLabel: language === 'es' ? 'Silencios largos' : 'Long silences',
    },
  }
}

function metricWordcloud(ctx: MetricContext): MetricResult {
  const { textMessages, participants, language } = ctx
  const overall = getWordCounts(textMessages)

  if (overall.size === 0) {
    return { hasData: false }
  }

  const topOverall = [...overall.entries()].sort((left, right) => right[1] - left[1])
  const series: MetricSeriesEntry[] = participants
    .map((name) => {
      const own = getWordCounts(textMessages.filter((message) => message.sender === name))
      const words: WordCloudDatum[] = [...own.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 40)
        .map(([word, count]) => ({ word, count }))
      return { name, words }
    })
    .filter((entry) => entry.words.length > 0)
    .map((entry) => ({ name: entry.name, chart: { kind: 'wordCloud', words: entry.words } as ChartData }))

  return {
    hasData: true,
    basic: {
      value: topOverall[0][0],
      label:
        language === 'es'
          ? `la palabra más repetida (${formatNumber(topOverall[0][1], language)} veces)`
          : `the most repeated word (${formatNumber(topOverall[0][1], language)} times)`,
      chart: { kind: 'wordCloud', words: topOverall.slice(0, 40).map(([word, count]) => ({ word, count })) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Nube personal por integrante. Escribí una palabra para buscarla.'
          : 'A personal cloud per participant. Type a word to search it.',
      series,
    },
  }
}

function metricRedflags(ctx: MetricContext): MetricResult {
  const { chatMessages, textMessages, language } = ctx

  const categoryHits = redFlagCategories.map((category) => ({
    category,
    messages: textMessages.filter((message) => category.pattern.test(normalizeForMatch(message.contentText))),
  }))
  const deletions = chatMessages.filter((message) => message.isDeleted)
  // 48h matches the threshold "Rachas de Inactividad" already uses for a "long
  // silence" — below that, gaps are just normal pauses, not a tension signal.
  const longSilences = getGaps(chatMessages).filter((gap) => gap.hours >= 48)
  const totalKeywordHits = categoryHits.reduce((sum, entry) => sum + entry.messages.length, 0)

  if (totalKeywordHits === 0 && deletions.length === 0 && longSilences.length === 0) {
    return { hasData: false }
  }

  // Rate-based, not absolute: a chat with 50,000 messages will rack up more raw
  // deletions and silences than one with 500 just by existing longer, so every
  // component is scaled against message volume before it can move the score.
  const weightedKeywordSum = categoryHits.reduce((sum, entry) => sum + entry.messages.length * entry.category.weight, 0)
  const messageCount = Math.max(textMessages.length, 1)
  const score = Math.min(
    100,
    Math.round(
      (weightedKeywordSum / messageCount) * 550 +
        (deletions.length / Math.max(chatMessages.length, 1)) * 180 +
        longSilences.length * 1.8,
    ),
  )

  if (score === 0) {
    return { hasData: false }
  }

  const byKeywordSender = countBySender(categoryHits.flatMap((entry) => entry.messages))

  const flaggedById = new Map<string, { message: ChatMessage; reason: string }>()
  for (const entry of categoryHits) {
    for (const message of entry.messages) {
      if (!flaggedById.has(message.id)) {
        flaggedById.set(message.id, { message, reason: categoryLabel(entry.category, language) })
      }
    }
  }
  for (const message of deletions) {
    if (!flaggedById.has(message.id)) {
      flaggedById.set(message.id, { message, reason: language === 'es' ? 'mensaje eliminado' : 'deleted message' })
    }
  }
  const flagged = [...flaggedById.values()].sort(
    (left, right) => (ctx.messageIndex.get(left.message.id) ?? 0) - (ctx.messageIndex.get(right.message.id) ?? 0),
  )

  return {
    hasData: true,
    basic: {
      value: `${score}/100`,
      label: language === 'es' ? 'puntuación heurística de tensión' : 'heuristic tension score',
      chart: {
        kind: 'bar',
        items: [
          ...categoryHits
            .filter((entry) => entry.messages.length > 0)
            .map((entry) => ({
              label: categoryLabel(entry.category, language),
              value: entry.messages.length,
              displayValue: formatNumber(entry.messages.length, language),
            })),
          ...(deletions.length > 0
            ? [
                {
                  label: language === 'es' ? 'Borrados' : 'Deletions',
                  value: deletions.length,
                  displayValue: formatNumber(deletions.length, language),
                },
              ]
            : []),
          ...(longSilences.length > 0
            ? [
                {
                  label: language === 'es' ? 'Silencios largos' : 'Long silences',
                  value: longSilences.length,
                  displayValue: formatNumber(longSilences.length, language),
                },
              ]
            : []),
        ],
      },
    },
    detail: {
      intro:
        language === 'es'
          ? 'No es un diagnóstico: cruza silencios largos, borrados y frases clave agrupadas por categoría (celos, insultos, culpa, rupturas).'
          : 'Not a diagnosis: it combines long silences, deletions, and keyword phrases grouped by category (jealousy, insults, guilt-tripping, breakups).',
      breakdown: totalKeywordHits > 0 ? breakdownPercent(byKeywordSender, totalKeywordHits) : undefined,
      groups: capGroups(flagged.map((entry) => momentGroup(ctx, entry.message, `${entry.message.sender} — ${entry.reason}`))),
      paginatedItemsLabel: language === 'es' ? 'Momentos señalados' : 'Flagged moments',
    },
  }
}

function metricCringe(ctx: MetricContext): MetricResult {
  const { textMessages, participants, language } = ctx
  const hits = textMessages.filter((message) => hasCringeWord(message.contentText))

  if (hits.length === 0) {
    return { hasData: false }
  }

  const bySender = countBySender(hits)
  const groupsList: MessageGroup[] = []

  for (const name of participants) {
    const own = hits.filter((message) => message.sender === name).slice(0, 5)
    for (const message of own) {
      groupsList.push(momentGroup(ctx, message, `${name} — ${formatDate(message.timestamp, language)}`))
    }
  }

  return {
    hasData: true,
    basic: {
      value: formatNumber(hits.length, language),
      label: language === 'es' ? 'momentos cringe detectados' : 'cringe-coded moments detected',
    },
    detail: {
      intro:
        language === 'es'
          ? 'Top 5 momentos cringe de cada integrante, con fecha y frase exacta.'
          : "Each participant's top 5 cringe moments, with date and exact quote.",
      breakdown: breakdownCount(bySender, language),
      groups: capGroups(groupsList),
      paginatedItemsLabel: language === 'es' ? 'Momentos cringe' : 'Cringe moments',
    },
  }
}

function metricArrepentido(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const deleted = chatMessages.filter((message) => message.isDeleted)

  if (deleted.length === 0) {
    return { hasData: false }
  }

  const bySender = countBySender(deleted)
  const top = topEntry(bySender)!

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.value, language),
      label: language === 'es' ? `mensajes borrados por ${top.key}` : `messages deleted by ${top.key}`,
      chart: { kind: 'bar', items: rankingBars(bySender, language, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Cuándo ocurren más arrepentimientos a lo largo del tiempo.'
          : 'When those second thoughts happen most, over time.',
      chart: { kind: 'timeline', points: dailyVolume(deleted, language) },
      breakdown: breakdownPercent(bySender, deleted.length),
    },
  }
}

function metricPoliglota(ctx: MetricContext): MetricResult {
  const { textMessages, participants, language } = ctx
  const bySender = new Map<string, number>()
  const termsBySender = new Map<string, Map<string, number>>()

  for (const message of textMessages) {
    if (!message.sender) {
      continue
    }

    const hits = tokenize(message.contentText).filter((token) => englishTokenHints.has(token))
    if (hits.length === 0) {
      continue
    }

    bySender.set(message.sender, (bySender.get(message.sender) ?? 0) + hits.length)
    const terms = termsBySender.get(message.sender) ?? new Map<string, number>()
    for (const hit of hits) {
      terms.set(hit, (terms.get(hit) ?? 0) + 1)
    }
    termsBySender.set(message.sender, terms)
  }

  const top = topEntry(bySender)

  if (!top) {
    return { hasData: false }
  }

  const total = [...bySender.values()].reduce((sum, value) => sum + value, 0)
  const series: MetricSeriesEntry[] = participants
    .map((name) => {
      const terms = termsBySender.get(name)
      const items: BarDatum[] = terms
        ? [...terms.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, PER_PARTICIPANT_TOP_LIMIT)
            .map(([term, count]) => ({ label: term, value: count, displayValue: `×${formatNumber(count, language)}` }))
        : []
      return { name, items }
    })
    .filter((entry) => entry.items.length > 0)
    .map((entry) => ({ name: entry.name, chart: { kind: 'bar', items: entry.items } as ChartData }))

  return {
    hasData: true,
    basic: {
      value: top.key,
      label: language === 'es' ? `mezcla más anglicismos (${top.value})` : `mixes in the most English terms (${top.value})`,
      chart: { kind: 'donut', items: [...bySender.entries()].map(([label, value]) => ({ label, value })) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Los términos importados favoritos de cada integrante.'
          : "Each participant's favorite imported terms.",
      breakdown: breakdownPercent(bySender, total),
      series,
    },
  }
}

function metricJajaja(ctx: MetricContext): MetricResult {
  const { textMessages, participants, language } = ctx
  const overall = new Map<string, number>()

  for (const message of textMessages) {
    for (const token of tokenize(message.contentText)) {
      const style = classifyLaugh(token)
      if (style) {
        const label = laughStyleLabel(style, language)
        overall.set(label, (overall.get(label) ?? 0) + 1)
      }
    }
  }

  const top = topEntry(overall)

  if (!top) {
    return { hasData: false }
  }

  const bySenderDominant = new Map<string, number>()
  const bySenderStyle = new Map<string, string>()
  const series: MetricSeriesEntry[] = []

  for (const name of participants) {
    const styles = new Map<string, number>()
    for (const message of textMessages.filter((entry) => entry.sender === name)) {
      for (const token of tokenize(message.contentText)) {
        const style = classifyLaugh(token)
        if (style) {
          const label = laughStyleLabel(style, language)
          styles.set(label, (styles.get(label) ?? 0) + 1)
        }
      }
    }

    const dominant = topEntry(styles)
    if (dominant) {
      bySenderDominant.set(name, dominant.value)
      bySenderStyle.set(name, dominant.key)
    }

    if (styles.size > 0) {
      series.push({ name, chart: { kind: 'bar', items: rankingBars(styles, language, 6) } })
    }
  }

  return {
    hasData: true,
    basic: {
      value: top.key,
      label:
        language === 'es'
          ? `es el estilo de risa dominante (${formatNumber(top.value, language)} veces)`
          : `is the dominant laugh style (${formatNumber(top.value, language)} times)`,
      chart: { kind: 'bar', items: rankingBars(overall, language, 6) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Cómo se ríe cada integrante, de la risa seca a la caótica.'
          : 'How each participant laughs, from the dry "ja" to full keyboard chaos.',
      breakdown: [...bySenderDominant.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([name, value]) => ({ name, value, displayValue: bySenderStyle.get(name) ?? '' })),
      series,
    },
  }
}

function metricMetralleta(ctx: MetricContext): MetricResult {
  const { chatMessages, language } = ctx
  const bursts = getMicroBursts(chatMessages)

  if (bursts.length === 0) {
    return { hasData: false }
  }

  const top = bursts[0]
  const bestBySender = new Map<string, number>()
  for (const burst of bursts) {
    bestBySender.set(burst.sender, Math.max(bestBySender.get(burst.sender) ?? 0, burst.count))
  }

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.count, language),
      label:
        language === 'es'
          ? `micro-mensajes seguidos de ${top.sender} en menos de 10s`
          : `micro-messages in a row from ${top.sender} in under 10s`,
      chart: { kind: 'bar', items: rankingBars(bestBySender, language, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Los combos de micro-mensajes más grandes, con el bloque literal.'
          : 'The biggest micro-message combos, with the literal block.',
      breakdown: breakdownCount(bestBySender, language),
      groups: capGroups(bursts.map((burst) => rangeGroup(ctx, burst.startMessage, burst.endMessage, burstHeading(burst, language)))),
      paginatedItemsLabel: language === 'es' ? 'Ráfagas de micro-mensajes' : 'Micro-message bursts',
    },
  }
}

function metricInterrogador(ctx: MetricContext): MetricResult {
  const { textMessages, language } = ctx
  const questions = new Map<string, number>()

  for (const message of textMessages) {
    if (!message.sender) {
      continue
    }
    const count = (message.contentText.match(/\?/g) ?? []).length
    if (count > 0) {
      questions.set(message.sender, (questions.get(message.sender) ?? 0) + count)
    }
  }

  const top = topEntry(questions)

  if (!top) {
    return { hasData: false }
  }

  const total = [...questions.values()].reduce((sum, value) => sum + value, 0)

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.value, language),
      label: language === 'es' ? `preguntas hechas por ${top.key}` : `questions asked by ${top.key}`,
      chart: { kind: 'bar', items: rankingBars(questions, language, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Quién pregunta más, en proporción al resto del grupo.'
          : 'Who asks the most, relative to the rest of the group.',
      breakdown: breakdownPercent(questions, total),
    },
  }
}

function metricDramatico(ctx: MetricContext): MetricResult {
  const { textMessages, participants, language } = ctx
  const shouted = textMessages.filter(isShouting)

  if (shouted.length === 0) {
    return { hasData: false }
  }

  const bySender = countBySender(shouted)
  const top = topEntry(bySender)!
  const groupsList: MessageGroup[] = []

  for (const name of participants) {
    const own = shouted
      .filter((message) => message.sender === name)
      .sort((left, right) => right.contentText.length - left.contentText.length)
      .slice(0, 3)

    for (const message of own) {
      groupsList.push(momentGroup(ctx, message, `${name} — ${formatDate(message.timestamp, language)}`))
    }
  }

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.value, language),
      label: language === 'es' ? `mensajes en MAYÚSCULAS de ${top.key}` : `all-caps messages from ${top.key}`,
      chart: { kind: 'bar', items: rankingBars(bySender, language, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Top 3 de mensajes más gritados de cada integrante.'
          : "Each participant's top 3 loudest messages.",
      breakdown: breakdownCount(bySender, language),
      groups: capGroups(groupsList),
      paginatedItemsLabel: language === 'es' ? 'Mensajes gritados' : 'Shouted messages',
    },
  }
}

function metricTonoPicante(ctx: MetricContext): MetricResult {
  const { textMessages, participants, language } = ctx
  const flagged = textMessages.filter((message) => hasFlirtyWord(message.contentText))

  if (flagged.length === 0) {
    return { hasData: false }
  }

  const bySender = countBySender(flagged)
  const top = topEntry(bySender)!
  const total = flagged.length
  const hours = hourBuckets(flagged)
  const termCounts = new Map<string, number>()

  for (const message of flagged) {
    const normalized = normalizeForMatch(message.contentText)
    for (const { word, pattern } of flirtyWordPatterns) {
      if (pattern.test(normalized)) {
        termCounts.set(word, (termCounts.get(word) ?? 0) + 1)
      }
    }
  }

  const groupsList: MessageGroup[] = []
  for (const name of participants) {
    const own = flagged.filter((message) => message.sender === name).slice(0, 5)
    for (const message of own) {
      groupsList.push(momentGroup(ctx, message, `${name} — ${formatDate(message.timestamp, language)}`))
    }
  }

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.value, language),
      label: language === 'es' ? `mensajes subidos de tono de ${top.key}` : `spicy messages from ${top.key}`,
      chart: { kind: 'bar', items: rankingPercentBars(bySender, total, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Horarios preferidos del grupo, los mensajes exactos de cada integrante y las palabras más usadas.'
          : "The group's preferred hours, each participant's exact messages, and the words used most.",
      chart: { kind: 'hourHeatmap', hours },
      breakdown: breakdownPercent(bySender, total),
      groups: capGroups(groupsList),
      groupsLabel: language === 'es' ? 'Los mensajes más picantes de cada uno' : "Each participant's spiciest messages",
      paginatedItems: capList(
        [...termCounts.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([word, count]) => (language === 'es' ? `"${word}" se usó ${count} veces` : `"${word}" used ${count} times`)),
      ),
      paginatedItemsLabel: language === 'es' ? 'Palabras más usadas' : 'Most used words',
    },
  }
}

function metricCurador(ctx: MetricContext): MetricResult {
  const { textMessages, language } = ctx
  const linksBySender = new Map<string, number>()
  const categoryCount = new Map<string, number>()

  for (const message of textMessages) {
    if (!message.sender) {
      continue
    }

    const urls = message.contentText.match(/https?:\/\/\S+/gi) ?? []
    if (urls.length === 0) {
      continue
    }

    linksBySender.set(message.sender, (linksBySender.get(message.sender) ?? 0) + urls.length)
    for (const url of urls) {
      const category = categorizeLink(url, language)
      categoryCount.set(category, (categoryCount.get(category) ?? 0) + 1)
    }
  }

  const top = topEntry(linksBySender)

  if (!top) {
    return { hasData: false }
  }

  const total = [...linksBySender.values()].reduce((sum, value) => sum + value, 0)

  return {
    hasData: true,
    basic: {
      value: formatNumber(top.value, language),
      label: language === 'es' ? `enlaces compartidos por ${top.key}` : `links shared by ${top.key}`,
      chart: { kind: 'bar', items: rankingBars(linksBySender, language, 8) },
    },
    detail: {
      intro:
        language === 'es'
          ? 'Qué tipo de contenido comparte más cada integrante.'
          : 'What kind of content each participant shares the most.',
      chart: { kind: 'donut', items: [...categoryCount.entries()].map(([label, value]) => ({ label, value })) },
      breakdown: breakdownPercent(linksBySender, total),
    },
  }
}

// ---------------------------------------------------------------------------
// Chat-bubble moment groups — shared by every metric that quotes real messages
// ---------------------------------------------------------------------------

function placeholderLabel(message: ChatMessage, language: Language): string {
  if (message.isDeleted) {
    return language === 'es' ? 'Mensaje eliminado' : 'Message deleted'
  }
  if (message.isMedia) {
    return language === 'es' ? 'Archivo multimedia' : 'Media file'
  }
  return language === 'es' ? '(sin texto)' : '(no text)'
}

function bubbleFor(message: ChatMessage, language: Language, isHighlight: boolean): ChatBubble {
  return {
    sender: message.sender ?? (language === 'es' ? 'Sistema' : 'System'),
    text: message.contentText || placeholderLabel(message, language),
    timestampLabel: formatDateTime(message.timestamp, language),
    isHighlight,
  }
}

function dividerBubble(skippedCount: number, language: Language): ChatBubble {
  const count = formatNumber(skippedCount, language)
  return {
    sender: '',
    text: language === 'es' ? `⋯ ${count} mensajes más ⋯` : `⋯ ${count} more messages ⋯`,
    timestampLabel: '',
    isHighlight: false,
    isDivider: true,
  }
}

/** One highlighted message plus the real message right before and after it, so the
 * user can recall the exchange instead of reading an isolated quote. */
function momentGroup(ctx: MetricContext, message: ChatMessage, heading: string): MessageGroup {
  const { chatMessages, language, messageIndex } = ctx
  const index = messageIndex.get(message.id) ?? -1
  const bubbles: ChatBubble[] = []

  for (let cursor = index - CONTEXT_WINDOW; cursor < index; cursor += 1) {
    if (cursor >= 0) {
      bubbles.push(bubbleFor(chatMessages[cursor], language, false))
    }
  }
  bubbles.push(bubbleFor(message, language, true))
  for (let cursor = index + 1; cursor <= index + CONTEXT_WINDOW; cursor += 1) {
    if (index >= 0 && cursor < chatMessages.length) {
      bubbles.push(bubbleFor(chatMessages[cursor], language, false))
    }
  }

  return { id: message.id, heading, bubbles }
}

/** A whole highlighted range (e.g. a streak block), with a few messages of context
 * right before the range started and right after it ended. Caps how many messages
 * inside the range actually render, so a 100-message burst doesn't flood the UI. */
function rangeGroup(
  ctx: MetricContext,
  startMessage: ChatMessage,
  endMessage: ChatMessage,
  heading: string,
  maxHighlighted = 8,
): MessageGroup {
  const { chatMessages, language, messageIndex } = ctx
  const startIndex = messageIndex.get(startMessage.id) ?? -1
  const endIndex = messageIndex.get(endMessage.id) ?? startIndex
  const bubbles: ChatBubble[] = []

  for (let cursor = startIndex - CONTEXT_WINDOW; cursor < startIndex; cursor += 1) {
    if (cursor >= 0) {
      bubbles.push(bubbleFor(chatMessages[cursor], language, false))
    }
  }

  const highlightEnd = Math.min(endIndex, startIndex + maxHighlighted - 1)
  for (let index = startIndex; index >= 0 && index <= highlightEnd; index += 1) {
    bubbles.push(bubbleFor(chatMessages[index], language, true))
  }

  // Truncated above `maxHighlighted`? Say so, and still show the real last message
  // of the range — otherwise this silently jumps straight to "after" context, which
  // reads as if the streak had already ended right after the first few messages.
  if (endIndex > highlightEnd) {
    const skippedCount = endIndex - highlightEnd - 1
    if (skippedCount > 0) {
      bubbles.push(dividerBubble(skippedCount, language))
    }
    bubbles.push(bubbleFor(chatMessages[endIndex], language, true))
  }

  for (let cursor = endIndex + 1; cursor <= endIndex + CONTEXT_WINDOW; cursor += 1) {
    if (endIndex >= 0 && cursor < chatMessages.length) {
      bubbles.push(bubbleFor(chatMessages[cursor], language, false))
    }
  }

  return { id: startMessage.id, heading, bubbles }
}

/** One group per calendar day: the real excerpt from that day, with a message of
 * context right before it started and right after it ended. */
function dayRangeGroup(ctx: MetricContext, day: string, heading: string, maxHighlighted = 8): MessageGroup | null {
  const dayMessages = ctx.chatMessages.filter((message) => dayKey(message.timestamp) === day)
  if (dayMessages.length === 0) {
    return null
  }
  return rangeGroup(ctx, dayMessages[0], dayMessages[dayMessages.length - 1], heading, maxHighlighted)
}

function capGroups(groups: MessageGroup[]): MessageGroup[] {
  return groups.slice(0, GROUP_CAP)
}

// ---------------------------------------------------------------------------
// Shared analysis helpers
// ---------------------------------------------------------------------------

function countBySender(messages: ChatMessage[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const message of messages) {
    if (!message.sender) {
      continue
    }
    map.set(message.sender, (map.get(message.sender) ?? 0) + 1)
  }
  return map
}

function topEntry(map: Map<string, number>): { key: string; value: number } | null {
  const entry = [...map.entries()].sort((left, right) => right[1] - left[1])[0]
  return entry ? { key: entry[0], value: entry[1] } : null
}

function percentage(value: number, total: number): string {
  return `${((value / Math.max(total, 1)) * 100).toFixed(1)}%`
}

export function formatNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language === 'es' ? 'es-AR' : 'en-US').format(value)
}

function rankingBars(map: Map<string, number>, language: Language, limit = 8): BarDatum[] {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value, displayValue: formatNumber(value, language) }))
}

function rankingPercentBars(map: Map<string, number>, total: number, limit = 8): BarDatum[] {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value, displayValue: percentage(value, total) }))
}

function breakdownCount(map: Map<string, number>, language: Language): ParticipantBreakdownEntry[] {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, value]) => ({ name, value, displayValue: formatNumber(value, language) }))
}

function breakdownPercent(map: Map<string, number>, total: number): ParticipantBreakdownEntry[] {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, value]) => ({ name, value, displayValue: percentage(value, total) }))
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).map((token) => token.normalize('NFC'))
}

function formatDate(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'es' ? 'es-AR' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function formatDateTime(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'es' ? 'es-AR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatMonthLabel(yearMonth: string, language: Language): string {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Intl.DateTimeFormat(language === 'es' ? 'es-AR' : 'en-US', { month: 'short', year: '2-digit' }).format(
    new Date(year, month - 1, 1),
  )
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function capList(items: string[]): string[] {
  return items.slice(0, DETAIL_LIST_CAP)
}

/** The timestamp shifted back by DAY_START_HOUR, so it can be bucketed by
 * "conversational day/weekday" — one that starts at 6am, not midnight. */
function conversationalDate(timestamp: string): Date {
  return new Date(new Date(timestamp).getTime() - DAY_START_HOUR * 3_600_000)
}

function dayKey(timestamp: string): string {
  const shifted = conversationalDate(timestamp)
  const year = shifted.getFullYear()
  const month = String(shifted.getMonth() + 1).padStart(2, '0')
  const day = String(shifted.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDurationMinutes(value: number, language: Language): string {
  if (value >= 60 * 24) {
    const days = value / (60 * 24)
    return language === 'es' ? `${days.toFixed(1)} días` : `${days.toFixed(1)} days`
  }
  if (value >= 60) {
    const hours = value / 60
    return language === 'es' ? `${hours.toFixed(1)} horas` : `${hours.toFixed(1)} hours`
  }
  return language === 'es' ? `${value.toFixed(1)} minutos` : `${value.toFixed(1)} minutes`
}

function formatDurationHours(hours: number, language: Language): string {
  if (hours >= 24) {
    const days = hours / 24
    return language === 'es' ? `${days.toFixed(1)} días` : `${days.toFixed(1)} days`
  }
  return language === 'es' ? `${hours.toFixed(1)} horas` : `${hours.toFixed(1)} hours`
}

function monthlyVolume(messages: ChatMessage[], language: Language): TimelinePoint[] {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const key = message.timestamp.slice(0, 7)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      dateLabel: formatMonthLabel(key, language),
      label: language === 'es' ? `${value} mensajes` : `${value} messages`,
      value,
    }))
}

function dailyVolume(messages: ChatMessage[], language: Language): TimelinePoint[] {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const key = dayKey(message.timestamp)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      dateLabel: formatDate(key, language),
      label: language === 'es' ? `${value} envíos` : `${value} sends`,
      value,
    }))
}

interface StreakBlock {
  sender: string
  count: number
  texts: string[]
  startMessage: ChatMessage
  endMessage: ChatMessage
}

function getStreakBlocks(messages: ChatMessage[]): StreakBlock[] {
  const blocks: StreakBlock[] = []
  let current: StreakBlock | null = null

  for (const message of messages) {
    if (!message.sender) {
      continue
    }

    if (current && current.sender === message.sender) {
      current.count += 1
      current.endMessage = message
      if (current.texts.length < 5 && message.contentText) {
        current.texts.push(message.contentText)
      }
    } else {
      current = {
        sender: message.sender,
        count: 1,
        texts: message.contentText ? [message.contentText] : [],
        startMessage: message,
        endMessage: message,
      }
      blocks.push(current)
    }
  }

  return blocks.filter((block) => block.count >= 2).sort((left, right) => right.count - left.count)
}

function maxStreakBySender(blocks: StreakBlock[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const block of blocks) {
    map.set(block.sender, Math.max(map.get(block.sender) ?? 0, block.count))
  }
  return map
}

function streakHeading(block: StreakBlock, language: Language): string {
  const count = formatNumber(block.count, language)
  return language === 'es' ? `${block.sender} encadenó ${count} mensajes:` : `${block.sender} chained ${count} messages:`
}

function hourBuckets(messages: ChatMessage[]): number[] {
  const hours = new Array(24).fill(0) as number[]
  for (const message of messages) {
    hours[new Date(message.timestamp).getHours()] += 1
  }
  return hours
}

function sumRange(hours: number[], indices: number[]): number {
  return indices.reduce((sum, index) => sum + hours[index], 0)
}

/** A message only counts as a genuine "icebreaker" when it starts a new
 * (6am-based) conversational day AND the chat had actually gone quiet for
 * ICEBREAKER_MIN_GAP_HOURS beforehand — otherwise a message sent minutes after
 * midnight-adjacent chatter would wrongly count as restarting the conversation. */
function getDayOpeners(messages: ChatMessage[]): ChatMessage[] {
  const openers: ChatMessage[] = []
  let currentDay = ''
  let previousTime: number | null = null

  for (const message of messages) {
    const day = dayKey(message.timestamp)
    const time = new Date(message.timestamp).getTime()
    const hadLongSilence = previousTime === null || time - previousTime >= ICEBREAKER_MIN_GAP_HOURS * 3_600_000

    if (message.sender && day !== currentDay && hadLongSilence) {
      openers.push(message)
    }
    currentDay = day
    previousTime = time
  }

  return openers.reverse()
}

function getEmojiCounts(messages: ChatMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const emojis = message.contentText.match(/\p{Extended_Pictographic}/gu) ?? []
    for (const emoji of emojis) {
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1)
    }
  }
  return counts
}

interface DailyStreak {
  startIso: string
  endIso: string
  days: number
}

function getDailyStreaks(messages: ChatMessage[]): DailyStreak[] {
  const days = [...new Set(messages.map((message) => dayKey(message.timestamp)))].sort()

  if (days.length === 0) {
    return []
  }

  const streaks: DailyStreak[] = []
  let start = days[0]
  let previous = days[0]

  for (let index = 1; index < days.length; index += 1) {
    const diff = Math.round((new Date(days[index]).getTime() - new Date(previous).getTime()) / 86_400_000)
    if (diff !== 1) {
      streaks.push(makeStreak(start, previous))
      start = days[index]
    }
    previous = days[index]
  }

  streaks.push(makeStreak(start, previous))

  return streaks.sort((left, right) => right.days - left.days)
}

function makeStreak(startIso: string, endIso: string): DailyStreak {
  const days = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 86_400_000) + 1
  return { startIso, endIso, days }
}

function getStreakParticipation(messages: ChatMessage[], streaks: DailyStreak[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const message of messages) {
    if (!message.sender) {
      continue
    }
    const day = dayKey(message.timestamp)
    const inStreak = streaks.some((streak) => day >= streak.startIso && day <= streak.endIso)
    if (inStreak) {
      map.set(message.sender, (map.get(message.sender) ?? 0) + 1)
    }
  }
  return map
}

function countByDay(messages: ChatMessage[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const message of messages) {
    const day = dayKey(message.timestamp)
    map.set(day, (map.get(day) ?? 0) + 1)
  }
  return map
}

function getWordAverages(messages: ChatMessage[]): { sender: string; average: number }[] {
  const buckets = new Map<string, { totalWords: number; totalMessages: number }>()

  for (const message of messages) {
    if (!message.sender) {
      continue
    }
    const current = buckets.get(message.sender) ?? { totalWords: 0, totalMessages: 0 }
    current.totalWords += message.wordCount
    current.totalMessages += 1
    buckets.set(message.sender, current)
  }

  return [...buckets.entries()]
    .map(([sender, stats]) => ({ sender, average: stats.totalWords / Math.max(stats.totalMessages, 1) }))
    .sort((left, right) => left.average - right.average)
}

function getLengthBuckets(messages: ChatMessage[], language: Language): BarDatum[] {
  let short = 0
  let medium = 0
  let long = 0

  for (const message of messages) {
    if (message.wordCount === 0) {
      continue
    }
    if (message.wordCount <= 3) {
      short += 1
    } else if (message.wordCount <= 10) {
      medium += 1
    } else {
      long += 1
    }
  }

  const labels = language === 'es' ? ['Cortos (1-3)', 'Medios (4-10)', 'Largos (11+)'] : ['Short (1-3)', 'Medium (4-10)', 'Long (11+)']

  return [
    { label: labels[0], value: short, displayValue: formatNumber(short, language) },
    { label: labels[1], value: medium, displayValue: formatNumber(medium, language) },
    { label: labels[2], value: long, displayValue: formatNumber(long, language) },
  ]
}

function getCalendarDays(messages: ChatMessage[]): CalendarDay[] {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const day = dayKey(message.timestamp)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count }))
}

function daySpan(days: CalendarDay[]): number {
  const sorted = days.map((day) => day.date).sort()
  return (new Date(sorted[sorted.length - 1]).getTime() - new Date(sorted[0]).getTime()) / 86_400_000
}

function truncateMonths(months: MonthDatum[]): MonthDatum[] {
  return months.length > CARD_MONTH_LIMIT ? months.slice(-CARD_MONTH_LIMIT) : months
}

function monthRangeOf(messages: ChatMessage[]): { start: string; end: string } {
  const months = messages.map((message) => message.timestamp.slice(0, 7)).sort()
  return { start: months[0], end: months[months.length - 1] }
}

function monthlyCounts(messages: ChatMessage[], range: { start: string; end: string }, language: Language): MonthDatum[] {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const key = message.timestamp.slice(0, 7)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const result: MonthDatum[] = []
  let [year, month] = range.start.split('-').map(Number)
  const [endYear, endMonth] = range.end.split('-').map(Number)

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    result.push({ monthLabel: formatMonthLabel(key, language), count: counts.get(key) ?? 0 })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return result
}

function getWeekdayCounts(messages: ChatMessage[], language: Language): RadarDatum[] {
  const counts = new Array(7).fill(0) as number[]
  for (const message of messages) {
    counts[conversationalDate(message.timestamp).getDay()] += 1
  }
  return weekdayLabels[language].map((axis, index) => ({ axis, value: counts[index] }))
}

interface ResponseEvent {
  sender: string
  minutes: number
  awaitingMessage: ChatMessage
  replyMessage: ChatMessage
}

function getResponseEvents(messages: ChatMessage[]): ResponseEvent[] {
  const events: ResponseEvent[] = []

  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1]
    const current = messages[index]

    if (!previous.sender || !current.sender || previous.sender === current.sender) {
      continue
    }
    if (!isAwaitingReply(previous)) {
      continue
    }

    const minutes = (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 60_000
    events.push({ sender: current.sender, minutes, awaitingMessage: previous, replyMessage: current })
  }

  return events
}

function isAwaitingReply(message: ChatMessage): boolean {
  if (message.isSystemPlaceholder) {
    return message.isMedia
  }
  return message.contentText.includes('?') || message.wordCount >= 3
}

function delayHeading(event: ResponseEvent, language: Language): string {
  return language === 'es'
    ? `${event.sender} tardó ${formatDurationMinutes(event.minutes, language)} en responder`
    : `${event.sender} took ${formatDurationMinutes(event.minutes, language)} to reply`
}

interface Gap {
  before: ChatMessage
  after: ChatMessage
  hours: number
}

function getGaps(messages: ChatMessage[]): Gap[] {
  const gaps: Gap[] = []
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1]
    const current = messages[index]
    const hours = (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 3_600_000
    gaps.push({ before: previous, after: current, hours })
  }
  return gaps
}

function silenceHeading(gap: Gap, language: Language): string {
  return language === 'es'
    ? `Silencio de ${formatDurationHours(gap.hours, language)} — retomó ${gap.after.sender}`
    : `${formatDurationHours(gap.hours, language)} of silence — ${gap.after.sender} broke it`
}

function getWordCounts(messages: ChatMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    for (const token of tokenize(message.contentText)) {
      if (token.length < 3 || stopWords.has(token)) {
        continue
      }
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }
  return counts
}

function hasCringeWord(text: string): boolean {
  if (roleplayActionPattern.test(text) || cutesySpamPattern.test(text)) {
    return true
  }
  return cringePattern.test(normalizeForMatch(text))
}

function hasFlirtyWord(text: string): boolean {
  return flirtyPattern.test(normalizeForMatch(text))
}

// Home-row letters that a "jaja"/"jsjs" laugh naturally spills onto when someone's
// thumbs slip while mashing the keyboard — matches the doc's own example ("ajskdhasjd").
const homeRowLetters = new Set(['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'])

function looksLikeKeyboardChaos(token: string): boolean {
  if (token.length < 4) {
    return false
  }
  const letters = [...token]
  const withinHomeRow = letters.every((letter) => homeRowLetters.has(letter))
  const hasLaughCluster = letters.includes('j')
  const uniqueLetters = new Set(letters).size
  return withinHomeRow && hasLaughCluster && uniqueLetters >= 3
}

/** Every laugh "family" the app can recognize — deliberately broader than a single
 * jaja/jeje pair, since real chats laugh in a lot more shapes than that. */
const laughStyleLabels: Record<string, Record<Language, string>> = {
  seca: { es: 'Risa seca ("ja")', en: 'Dry laugh ("ha")' },
  jaja: { es: 'Jajaja clásica', en: 'Classic "hahaha"' },
  jeje: { es: 'Jeje pícaro', en: 'Sly "hehe"' },
  jiji: { es: 'Jiji tímida', en: 'Giggly "hihi"' },
  jojo: { es: 'Jojo', en: 'Jojo' },
  jsjs: { es: 'Jsjsjs', en: 'Jsjsjs' },
  haha: { es: 'Haha en inglés', en: 'Haha' },
  hehe: { es: 'Hehe en inglés', en: 'Hehe' },
  xd: { es: 'XD', en: 'XD' },
  lol: { es: 'LOL', en: 'LOL' },
  lmao: { es: 'LMAO', en: 'LMAO' },
  rofl: { es: 'ROFL', en: 'ROFL' },
  keysmash: { es: 'Perdió el teclado', en: 'Lost control of the keyboard' },
}

function laughStyleLabel(style: string, language: Language): string {
  return laughStyleLabels[style]?.[language] ?? style
}

function classifyLaugh(rawToken: string): string | null {
  const token = rawToken.toLowerCase()

  if (token.length < 2) {
    return null
  }
  if (/^(?:ja|je|ji|jo|ha|he)$/.test(token)) {
    return 'seca'
  }
  if (/^a*(?:ja)+j?a*$/.test(token)) return 'jaja'
  if (/^e*(?:je)+j?e*$/.test(token)) return 'jeje'
  if (/^i*(?:ji)+j?i*$/.test(token)) return 'jiji'
  if (/^o*(?:jo)+j?o*$/.test(token)) return 'jojo'
  if (/^(?:js)+j?$/.test(token)) return 'jsjs'
  if (/^(?:ha){2,}h?$/.test(token)) return 'haha'
  if (/^(?:he){2,}h?$/.test(token)) return 'hehe'
  if (/^x+d+$/.test(token)) return 'xd'
  if (/^lo+l+$/.test(token)) return 'lol'
  if (/^lm(?:f)?ao+$/.test(token)) return 'lmao'
  if (/^rot?fl+$/.test(token)) return 'rofl'
  if (looksLikeKeyboardChaos(token)) return 'keysmash'

  return null
}

interface Burst {
  sender: string
  count: number
  startMessage: ChatMessage
  endMessage: ChatMessage
}

function getMicroBursts(messages: ChatMessage[]): Burst[] {
  const bursts: Burst[] = []
  let current: Burst | null = null
  let previousTime = 0
  let previousSender = ''

  for (const message of messages) {
    if (!message.sender) {
      continue
    }

    const time = new Date(message.timestamp).getTime()
    const isShort = message.wordCount > 0 && message.wordCount <= 2
    const continues = isShort && current !== null && message.sender === previousSender && time - previousTime <= 10_000

    if (continues && current) {
      current.count += 1
      current.endMessage = message
    } else if (isShort) {
      current = { sender: message.sender, count: 1, startMessage: message, endMessage: message }
      bursts.push(current)
    } else {
      current = null
    }

    previousTime = time
    previousSender = message.sender
  }

  return bursts.filter((burst) => burst.count >= 3).sort((left, right) => right.count - left.count)
}

function burstHeading(burst: Burst, language: Language): string {
  const count = formatNumber(burst.count, language)
  return language === 'es' ? `${burst.sender} encadenó ${count} mensajes cortos:` : `${burst.sender} chained ${count} short messages:`
}

function isShouting(message: ChatMessage): boolean {
  const letters = message.contentText.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '')
  return letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

function categorizeLink(url: string, language: Language): string {
  const lower = url.toLowerCase()
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube'
  if (lower.includes('tiktok.com')) return 'TikTok'
  if (lower.includes('instagram.com')) return 'Instagram'
  if (lower.includes('spotify.com')) return language === 'es' ? 'Música' : 'Music'
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X/Twitter'
  return language === 'es' ? 'Otros' : 'Other'
}
