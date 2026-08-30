import type { WordCloudDatum } from '../../types'
import { colorForIndex } from './palette'
import { Tooltip } from '../Tooltip'

const MIN_SIZE = 0.85
const MAX_SIZE = 2.4
// A compact card only has room for a handful of words at a restrained size —
// otherwise the tallest word cloud dictates the height of every card next to
// it. The full list still renders wherever compact isn't set (e.g. "Ver más").
const COMPACT_WORD_LIMIT = 14
const COMPACT_MAX_SIZE = 1.5

/** Slices to COMPACT_WORD_LIMIT, but never at the cost of a protected word — those
 * survive the cut even if that means dropping one more of the rest than usual. */
function takeCompact(words: WordCloudDatum[], protectedWords: string[] | undefined): WordCloudDatum[] {
  if (words.length <= COMPACT_WORD_LIMIT || !protectedWords || protectedWords.length === 0) {
    return words.slice(0, COMPACT_WORD_LIMIT)
  }
  const protectedSet = new Set(protectedWords)
  const kept = words.filter((word) => protectedSet.has(word.word))
  const rest = words.filter((word) => !protectedSet.has(word.word)).slice(0, Math.max(0, COMPACT_WORD_LIMIT - kept.length))
  return [...kept, ...rest]
}

export function WordCloud({
  words,
  unit,
  compact = false,
  onRemoveWord,
  removeLabel,
  justAddedWord,
  removingWord,
  selectedWordForRemoval,
  onToggleSelection,
  protectedWords,
}: {
  words: WordCloudDatum[]
  unit?: string
  compact?: boolean
  /** Passing this makes every bubble show a gray "×" to its right on click.
   * Omitted everywhere except the wordcloud metric's hero chart, which is
   * the only cloud worth editing (see useEditableWordCloud). */
  onRemoveWord?: (word: string) => void
  /** `{word}` placeholder gets replaced with the actual word. */
  removeLabel?: string
  /** The word a search just added — pops in instead of appearing instantly,
   * so it reads as "found and added" rather than the cloud silently changing. */
  justAddedWord?: string | null
  /** The word whose "×" was just clicked — shows a spinner in its place and
   * ignores further clicks until the removal actually commits. */
  removingWord?: string | null
  /** The word currently selected for removal (toggle on click) */
  selectedWordForRemoval?: string | null
  /** Called when a word is clicked to toggle its selection */
  onToggleSelection?: (word: string) => void
  /** Words the compact truncation below must never drop — a participant's cloud is
   * rendered compact, and a word the viewer deliberately searched for landed at the
   * *end* of `words` (see useEditableWordCloud), so a blind slice to COMPACT_WORD_LIMIT
   * would cut it before it ever got the chance to render. */
  protectedWords?: string[]
}) {
  if (words.length === 0) {
    return null
  }

  const editable = Boolean(onRemoveWord)
  const shown = compact ? takeCompact(words, protectedWords) : words
  const maxSize = compact ? COMPACT_MAX_SIZE : MAX_SIZE
  const max = Math.max(...shown.map((word) => word.count), 1)
  const min = Math.min(...shown.map((word) => word.count))
  const range = Math.max(max - min, 1)

  return (
    <div className={`chart-word-cloud ${compact ? 'is-compact' : ''}`}>
      {shown.map((word, index) => {
        const scale = MIN_SIZE + ((word.count - min) / range) * (maxSize - MIN_SIZE)
        const isNew = word.word === justAddedWord
        const isRemoving = word.word === removingWord
        const isSelected = word.word === selectedWordForRemoval
        return (
          <Tooltip key={word.word} content={`${word.word} · ${word.count}${unit ? ` ${unit}` : ''}`}>
            <span
              className={`chart-word-cloud-item ${editable ? 'is-editable' : ''} ${isNew ? 'is-new' : ''} ${isRemoving ? 'is-removing' : ''} ${isSelected ? 'is-selected' : ''}`}
              style={{ fontSize: `${scale}rem`, color: colorForIndex(index) }}
              onClick={() => editable && onToggleSelection?.(word.word)}
              role={editable ? 'button' : undefined}
              tabIndex={editable ? 0 : undefined}
            >
              {word.word}
              {editable ? (
                isRemoving ? (
                  <span className="chart-word-cloud-remove-spinner" aria-hidden="true" />
                ) : isSelected ? (
                  <button
                    type="button"
                    className="chart-word-cloud-remove"
                    aria-label={removeLabel?.replace('{word}', word.word) ?? word.word}
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemoveWord!(word.word)
                    }}
                  >
                    ×
                  </button>
                ) : null
              ) : null}
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}
