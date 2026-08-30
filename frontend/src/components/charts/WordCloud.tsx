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

export function WordCloud({
  words,
  unit,
  compact = false,
  onRemoveWord,
  removeLabel,
  justAddedWord,
  removingWord,
}: {
  words: WordCloudDatum[]
  unit?: string
  compact?: boolean
  /** Passing this makes every bubble show a gray "×" to its right on hover/focus
   * — no click needed to reveal it. Omitted everywhere except the wordcloud
   * metric's hero chart, which is the only cloud worth editing (see
   * useEditableWordCloud). */
  onRemoveWord?: (word: string) => void
  /** `{word}` placeholder gets replaced with the actual word. */
  removeLabel?: string
  /** The word a search just added — pops in instead of appearing instantly,
   * so it reads as "found and added" rather than the cloud silently changing. */
  justAddedWord?: string | null
  /** The word whose "×" was just clicked — shows a spinner in its place and
   * ignores further clicks until the removal actually commits. */
  removingWord?: string | null
}) {
  if (words.length === 0) {
    return null
  }

  const editable = Boolean(onRemoveWord)
  const shown = compact ? words.slice(0, COMPACT_WORD_LIMIT) : words
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
        return (
          <Tooltip key={word.word} content={`${word.word} · ${word.count}${unit ? ` ${unit}` : ''}`}>
            <span
              className={`chart-word-cloud-item ${editable ? 'is-editable' : ''} ${isNew ? 'is-new' : ''} ${isRemoving ? 'is-removing' : ''}`}
              style={{ fontSize: `${scale}rem`, color: colorForIndex(index) }}
            >
              {word.word}
              {editable ? (
                isRemoving ? (
                  <span className="chart-word-cloud-remove-spinner" aria-hidden="true" />
                ) : (
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
                )
              ) : null}
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}
