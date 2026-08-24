import type { ChatMessage } from '../types'

/**
 * Constructores de `ChatMessage` para los tests.
 *
 * Existen en vez de armar objetos a mano en cada test por dos razones: `ChatMessage`
 * tiene diez campos y sólo dos o tres importan en cada caso, y varias métricas leen
 * campos derivados (`contentText`, `wordCount`, `isSystemPlaceholder`) que si se calculan
 * mal en el fixture producen un test que pasa por el motivo equivocado. Acá se derivan
 * con las mismas reglas que usa `lib/parser.ts`.
 */

export interface MessageSpec {
  /** ISO local sin zona, p. ej. "2025-03-04T21:15". */
  at: string
  from?: string | null
  text?: string
  isMedia?: boolean
  isDeleted?: boolean
  /** Marcador de WhatsApp sin texto propio ("<Media omitted>"). */
  isPlaceholder?: boolean
  isSystem?: boolean
}

function countWords(value: string): number {
  return (value.match(/[\p{L}\p{N}']+/gu) ?? []).length
}

let sequence = 0

/** Un mensaje suelto. El id es estable dentro de un mismo test para poder referenciarlo. */
export function message(spec: MessageSpec): ChatMessage {
  const timestamp = new Date(spec.at).toISOString()
  const raw = spec.text ?? ''
  const contentText = spec.isPlaceholder ? '' : raw
  sequence += 1

  return {
    id: `${timestamp}-${sequence}`,
    timestamp,
    sender: spec.from === undefined ? 'Ana' : spec.from,
    message: raw,
    contentText,
    isSystem: spec.isSystem ?? spec.from === null,
    isMedia: spec.isMedia ?? false,
    isDeleted: spec.isDeleted ?? false,
    isSystemPlaceholder: spec.isPlaceholder ?? (contentText.length === 0 && raw.length > 0),
    wordCount: countWords(contentText),
  }
}

/** Una conversación completa, con ids correlativos y en el orden dado. */
export function chat(...specs: MessageSpec[]): ChatMessage[] {
  return specs.map(message)
}

/** Reinicia el contador de ids. Llamalo en `beforeEach` si un test compara ids literales. */
export function resetMessageIds(): void {
  sequence = 0
}

/**
 * `count` mensajes de un mismo remitente separados por `stepMinutes`, empezando en `at`.
 * Para métricas que necesitan volumen (rachas, ráfagas, heatmaps) sin escribir 40 líneas.
 */
export function burst(options: {
  at: string
  from: string
  count: number
  stepMinutes?: number
  text?: (index: number) => string
}): MessageSpec[] {
  const start = new Date(options.at).getTime()
  const step = (options.stepMinutes ?? 1) * 60_000

  return Array.from({ length: options.count }, (_, index) => ({
    at: new Date(start + index * step).toISOString(),
    from: options.from,
    text: options.text?.(index) ?? `mensaje numero ${index}`,
  }))
}

/**
 * Un día de conversación alternando entre dos personas.
 *
 * Las horas se expresan siempre en hora local (sin "Z") y `message` las vuelve a
 * convertir a ISO: así una aserción sobre "las 21h" vale igual en la máquina de
 * desarrollo (UTC-3) que en el runner de CI (UTC), porque el viaje de ida y vuelta
 * es simétrico.
 */
export function conversation(options: {
  day: string
  people: [string, string]
  turns: string[]
  startHour?: number
  stepMinutes?: number
}): MessageSpec[] {
  const step = options.stepMinutes ?? 5
  const startMinutes = (options.startHour ?? 10) * 60

  return options.turns.map((text, index) => {
    const minuteOfDay = startMinutes + index * step
    const hh = String(Math.floor(minuteOfDay / 60) % 24).padStart(2, '0')
    const mm = String(minuteOfDay % 60).padStart(2, '0')

    return { at: `${options.day}T${hh}:${mm}:00`, from: options.people[index % 2], text }
  })
}
