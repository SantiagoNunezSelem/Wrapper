import JSZip from 'jszip'
import type { ChatMessage } from '../types'
import { sha256Hex } from './hash'

// Tolera las cuatro formas en que WhatsApp abre una línea, según el sistema operativo,
// el idioma del teléfono y la versión de la app:
//
//   13/03/2025, 21:15 - Ana: hola      (Android, reloj de 24 horas)
//   20/1/2026 15:30 - Juan: hola       (sin coma entre fecha y hora)
//   [13/03/2025, 21:15:00] Ana: hola   (iOS: corchetes y sin guion)
//   3/13/25, 9:15 PM - Ana: hola       (en-US, reloj de 12 horas)
//
// El `\s*` que precede al meridiano va DENTRO del grupo opcional a propósito: dos `\s*`
// adyacentes alrededor de un grupo opcional vuelven la búsqueda cuadrática, y esto corre
// sobre cada línea de un archivo que sube el usuario, en el hilo principal. Medido: una
// línea de 16.000 espacios pasa de 0,1 ms a 526 ms con la variante ingenua.
//
// Ese mismo `\s*` es lo que hace innecesario un caso especial para el espacio angosto
// (U+202F) que las versiones nuevas ponen antes del "PM": el `\s` de JavaScript ya cubre
// toda la categoría Zs.
const messageStartPattern =
  /^\[?(?<date>\d{1,2}[/-]\d{1,2}[/-]\d{2,4}),?\s*(?<time>\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(?<meridiem>[ap]\.?\s?m\.?))?\s*(?:\]\s*-?|-)\s*(?<body>.*)$/i

type DateOrder = 'MDY' | 'DMY'

interface RawEntry {
  date: string
  time: string
  /** "PM", "p. m.", … cuando el export usa reloj de 12 horas; ausente en los de 24. */
  meridiem?: string
  body: string
}

export interface ParsedChat {
  messages: ChatMessage[]
  sourceHash: string
  // Sólo para diagnóstico cuando `messages` termina vacío — los primeros caracteres
  // del texto ya decodificado, para poder ver en la consola qué contenido llegó
  // realmente. Va a console.warn, nunca al mensaje de error en pantalla: el archivo
  // puede no ser un chat en absoluto, y su contenido no es nuestro para mostrar.
  rawTextPreview: string
}

export async function parseChatFile(file: File): Promise<ParsedChat> {
  const text = await readFileText(file)
  return parseChatText(text)
}

async function readFileText(file: File): Promise<string> {
  // No confiamos en el nombre para distinguir zip de texto plano: el share-target de
  // WhatsApp no siempre preserva la extensión original (a veces llega sin ".zip" o con
  // un nombre genérico), así que sniffeamos la firma real del archivo ("PK", los dos
  // primeros bytes de todo .zip) en vez de mirar `file.name`.
  const buffer = await file.arrayBuffer()

  if (isZipSignature(buffer)) {
    const archive = await JSZip.loadAsync(buffer)
    const txtFile = archive.file(/\.txt$/i)[0]

    if (!txtFile) {
      throw new Error('No se encontró un archivo .txt dentro del .zip.')
    }

    return txtFile.async('text')
  }

  return new TextDecoder('utf-8').decode(buffer)
}

function isZipSignature(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength))
  return bytes.length === 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

export async function parseChatText(text: string): Promise<ParsedChat> {
  // Normalize before hashing so the same export re-uploaded (possibly saved with
  // different line endings) always produces the same fingerprint.
  const normalized = text.replace(/\uFEFF/g, '').replace(/\r\n/g, '\n').trim()
  const sourceHash = await sha256Hex(normalized)
  const lines = normalized.split('\n')
  const rawEntries: RawEntry[] = []

  for (const rawLine of lines) {
    // Some WhatsApp export locales/versions prefix every line with an invisible
    // U+200E/U+200F mark. Left in place, it sits before the `^` anchor and makes
    // messageStartPattern silently fail to match — the line then gets glued onto
    // the previous message as a "continuation" instead of starting a new one,
    // which quietly merges a real interruption into whoever spoke before it.
    const line = stripInvisibleMarks(rawLine)
    const match = line.match(messageStartPattern)
    if (match?.groups) {
      rawEntries.push({
        date: match.groups.date,
        time: match.groups.time,
        meridiem: match.groups.meridiem,
        body: match.groups.body.trim(),
      })
      continue
    }

    if (rawEntries.length === 0) {
      continue
    }

    rawEntries[rawEntries.length - 1].body += `\n${line}`
  }

  const rawTextPreview = normalized.slice(0, 200)
  const dateOrder = inferDateOrder(rawEntries)

  const messages: ChatMessage[] = rawEntries.map((entry, index) => {
    const separatorIndex = entry.body.indexOf(': ')
    const hasSender = separatorIndex > 0
    const sender = hasSender ? entry.body.slice(0, separatorIndex).trim() : null
    const content = hasSender ? entry.body.slice(separatorIndex + 2).trim() : entry.body.trim()
    const rawMessage = content || entry.body.trim()
    const timestamp = parseTimestamp(entry, dateOrder)
    const contentText = stripSystemTags(rawMessage)

    return {
      id: `${timestamp.toISOString()}-${index}`,
      timestamp: timestamp.toISOString(),
      sender,
      message: rawMessage,
      contentText,
      isSystem: sender === null,
      isMedia: mediaPhrasePattern.test(stripInvisibleMarks(rawMessage)),
      isDeleted: deletedMessagePattern.test(rawMessage),
      isSystemPlaceholder: contentText.length === 0 && rawMessage.length > 0,
      wordCount: countWords(contentText),
    }
  })

  return { messages, sourceHash, rawTextPreview }
}

function inferDateOrder(entries: RawEntry[]): DateOrder {
  let mdyVotes = 0
  let dmyVotes = 0
  let twelveHourEntries = 0

  for (const entry of entries.slice(0, 50)) {
    const [first, second] = entry.date.split(/[/-]/).map(Number)

    if (first > 12) {
      dmyVotes += 1
    } else if (second > 12) {
      mdyVotes += 1
    }

    if (entry.meridiem) {
      twelveHourEntries += 1
    }
  }

  if (dmyVotes !== mdyVotes) {
    return dmyVotes > mdyVotes ? 'DMY' : 'MDY'
  }

  // Empate, o un archivo entero ambiguo: ningún día pasó de 12, así que las cifras solas
  // no alcanzan para decidir. Desempata el reloj — un export con AM/PM viene casi siempre
  // de un teléfono en inglés, que escribe mes/día; cualquier otro idioma en el que
  // WhatsApp exporta usa 24 horas y día/mes, que además es lo que espera el público de
  // esta app.
  return twelveHourEntries > 0 ? 'MDY' : 'DMY'
}

function parseTimestamp(entry: RawEntry, dateOrder: DateOrder): Date {
  const [a, b, rawYear] = entry.date.split(/[/-]/).map(Number)
  const [hours, minutes, seconds = 0] = entry.time.split(':').map(Number)
  const year = rawYear < 100 ? 2000 + rawYear : rawYear
  const [month, day] = dateOrder === 'DMY' ? [b, a] : [a, b]

  return new Date(year, month - 1, day, to24Hour(hours, entry.meridiem), minutes, seconds)
}

/**
 * Pasa una hora de reloj de 12 a una de 24. Las 12 AM son la medianoche y las 12 PM el
 * mediodía; el resto de la tarde suma 12.
 *
 * El guard de `hours > 12` cubre un dato malformado ("21:15 PM", que aparece en exports
 * de apps de terceros): sin él, `new Date` con hora 33 no falla — rueda al día siguiente
 * en silencio y corrompe el timestamp.
 */
function to24Hour(hours: number, meridiem: string | undefined): number {
  if (!meridiem || hours > 12) {
    return hours
  }

  // La captura llega como "PM", "pm", "p.m." o "p. m.", con espacio angosto incluido.
  const isPm = /^p/i.test(meridiem.replace(/[\s.]/g, ''))

  if (hours === 12) {
    return isPm ? 12 : 0
  }

  return isPm ? hours + 12 : hours
}

function countWords(value: string): number {
  const matches = value.match(/[\p{L}\p{N}']+/gu)
  return matches?.length ?? 0
}

const deletedMessagePattern =
  /(this message was deleted|you deleted this message|se elimin[oó] este mensaje|eliminaste este mensaje)/i

// WhatsApp wraps auto-generated markers in angle brackets, e.g. "<Media omitted>",
// "<Video note omitted>", or appends "<This message was edited>" as a suffix to a
// real message. None of that is text the person actually typed, so it must never
// feed word clouds, longest-message, or laugh/caps/keyword stats. The bracket body
// is capped and newline-free so it can never swallow a pasted multi-line block.
const bracketTagPattern = /<[^<>\n]{1,60}>/g
const invisibleMarksPattern = /[\u200E\u200F\uFEFF]/g

function stripInvisibleMarks(value: string): string {
  return value.replace(invisibleMarksPattern, '')
}

function stripSystemTags(value: string): string {
  return stripInvisibleMarks(value)
    .replace(bracketTagPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Covers bracketed ("<Media omitted>", "<Multimedia omitido>") and bracket-less
// variants some export locales/versions use, in Spanish and English, so "El Fan
// de la Multimedia" is the only stat that ever looks at these placeholders.
const mediaPhrasePattern =
  /(image|video( note)?|audio|document|sticker|gif|contact card) omitted|multimedia omitido|imagen omitida|nota de (audio|video) omitida|documento omitido|figurita omitida|tarjeta de contacto omitida|media omitted/i
