// ---------------------------------------------------------------------------
// Hiding who is who in the text that leaves the browser.
//
// The personalities and the red-flags scan send text, not just keyword hits, and names inside a
// message are as identifying as the label of whoever wrote it. So both give every participant a
// letter and rewrite what is said with the same letters.
// ---------------------------------------------------------------------------

/** A, B, C… — the letter a participant is known by outside the browser. */
export function letterFor(index: number): string {
  return String.fromCharCode(65 + index)
}

const urlPattern = /https?:\/\/\S+|www\.\S+/giu
const emailPattern = /[\w.+-]+@[\w-]+\.[\w.-]+/gu
const phonePattern = /\+?\d[\d\s().-]{6,}\d/gu

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
export function buildScrubber(participants: string[], letters: Map<string, string>): (text: string) => string {
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
