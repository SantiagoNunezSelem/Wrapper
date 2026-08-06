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

export function WordCloud({ words, unit, compact = false }: { words: WordCloudDatum[]; unit?: string; compact?: boolean }) {
  if (words.length === 0) {
    return null
  }

  const shown = compact ? words.slice(0, COMPACT_WORD_LIMIT) : words
  const maxSize = compact ? COMPACT_MAX_SIZE : MAX_SIZE
  const max = Math.max(...shown.map((word) => word.count), 1)
  const min = Math.min(...shown.map((word) => word.count))
  const range = Math.max(max - min, 1)

  return (
    <div className={`chart-word-cloud ${compact ? 'is-compact' : ''}`}>
      {shown.map((word, index) => {
        const scale = MIN_SIZE + ((word.count - min) / range) * (maxSize - MIN_SIZE)
        return (
          <Tooltip key={word.word} content={`${word.word} · ${word.count}${unit ? ` ${unit}` : ''}`}>
            <span className="chart-word-cloud-item" style={{ fontSize: `${scale}rem`, color: colorForIndex(index) }}>
              {word.word}
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}
