import JSZip from 'jszip'
import type { ChatMessage } from '../types'
import { sha256Hex } from './hash'

const messageStartPattern =
  /^(\[)?(?<date>\d{1,2}[/-]\d{1,2}[/-]\d{2,4})(?:,\s*)?(?<time>\d{1,2}:\d{2}(?::\d{2})?)(?:\]\s*-\s*|\s*-\s*)(?<body>.*)$/

type DateOrder = 'MDY' | 'DMY'

interface RawEntry {
  date: string
  time: string
  body: string
}

export interface ParsedChat {
  messages: ChatMessage[]
  sourceHash: string
}

export async function parseChatFile(file: File): Promise<ParsedChat> {
  const text = await readFileText(file)
  return parseChatText(text)
}

async function readFileText(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.zip')) {
    const archive = await JSZip.loadAsync(await file.arrayBuffer())
    const txtFile = archive.file(/\.txt$/i)[0]

    if (!txtFile) {
      throw new Error('No se encontró un archivo .txt dentro del .zip.')
    }

    return txtFile.async('text')
  }

  return file.text()
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
        body: match.groups.body.trim(),
      })
      continue
    }

    if (rawEntries.length === 0) {
      continue
    }

    rawEntries[rawEntries.length - 1].body += `\n${line}`
  }

  const dateOrder = inferDateOrder(rawEntries)

  const messages: ChatMessage[] = rawEntries.map((entry, index) => {
    const separatorIndex = entry.body.indexOf(': ')
    const hasSender = separatorIndex > 0
    const sender = hasSender ? entry.body.slice(0, separatorIndex).trim() : null
    const content = hasSender ? entry.body.slice(separatorIndex + 2).trim() : entry.body.trim()
    const rawMessage = content || entry.body.trim()
    const timestamp = parseTimestamp(entry.date, entry.time, dateOrder)
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

  return { messages, sourceHash }
}

function inferDateOrder(entries: RawEntry[]): DateOrder {
  let mdyVotes = 0
  let dmyVotes = 0

  for (const entry of entries.slice(0, 50)) {
    const [first, second] = entry.date.split(/[/-]/).map(Number)

    if (first > 12) {
      dmyVotes += 1
    } else if (second > 12) {
      mdyVotes += 1
    }
  }

  return dmyVotes > mdyVotes ? 'DMY' : 'MDY'
}

function parseTimestamp(datePart: string, timePart: string, dateOrder: DateOrder): Date {
  const [a, b, rawYear] = datePart.split(/[/-]/).map(Number)
  const [hours, minutes, seconds = 0] = timePart.split(':').map(Number)
  const year = rawYear < 100 ? 2000 + rawYear : rawYear
  const [month, day] = dateOrder === 'DMY' ? [b, a] : [a, b]

  return new Date(year, month - 1, day, hours, minutes, seconds)
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
