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
  selectedWord,
  onWordClick,
  onDeselect,
  onRemoveWord,
  removeLabel,
}: {
  words: WordCloudDatum[]
  unit?: string
  compact?: boolean
  /** The word currently showing its delete "×" — only meaningful together with
   * `onWordClick`/`onRemoveWord`. Passing none of these three keeps the cloud
   * read-only, which is what every usage except the wordcloud metric's hero
   * chart wants (see useEditableWordCloud). */
  selectedWord?: string | null
  onWordClick?: (word: string) => void
  /** Fired when a click lands on the cloud but not on a word — deselects
   * whatever was selected instead of leaving the "×" stuck open. */
  onDeselect?: () => void
  onRemoveWord?: (word: string) => void
  /** `{word}` placeholder gets replaced with the actual word. */
  removeLabel?: string
}) {
  if (words.length === 0) {
    return null
  }

  const editable = Boolean(onWordClick)
  const shown = compact ? words.slice(0, COMPACT_WORD_LIMIT) : words
  const maxSize = compact ? COMPACT_MAX_SIZE : MAX_SIZE
  const max = Math.max(...shown.map((word) => word.count), 1)
  const min = Math.min(...shown.map((word) => word.count))
  const range = Math.max(max - min, 1)

  return (
    <div
      className={`chart-word-cloud ${compact ? 'is-compact' : ''}`}
      onClick={editable && selectedWord ? onDeselect : undefined}
    >
      {shown.map((word, index) => {
        const scale = MIN_SIZE + ((word.count - min) / range) * (maxSize - MIN_SIZE)
        const isSelected = editable && selectedWord === word.word
        return (
          <Tooltip key={word.word} content={`${word.word} · ${word.count}${unit ? ` ${unit}` : ''}`}>
            <span
              className={`chart-word-cloud-item ${isSelected ? 'is-selected' : ''}`}
              style={{ fontSize: `${scale}rem`, color: colorForIndex(index) }}
              role={editable ? 'button' : undefined}
              tabIndex={editable ? 0 : undefined}
              onClick={
                editable
                  ? (event) => {
                      event.stopPropagation()
                      onWordClick!(word.word)
                    }
                  : undefined
              }
            >
              {word.word}
              {isSelected ? (
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
              ) : null}
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}
