import type { ChartData } from '../../types'
import { ActivityWave } from './ActivityWave'
import { BarRanking } from './BarRanking'
import { CalendarStreak } from './CalendarStreak'
import { Donut } from './Donut'
import { HourHeatmap } from './HourHeatmap'
import { MonthHeatmap } from './MonthHeatmap'
import { RadarChart } from './RadarChart'
import { Timeline } from './Timeline'
import { WordCloud } from './WordCloud'
import { YearHeatmap } from './YearHeatmap'

/** Only ever passed for the wordcloud metric's hero chart, the one cloud a
 * search can remove a word from — every other caller renders a read-only
 * cloud. See useEditableWordCloud. */
export interface WordCloudEditing {
  onRemoveWord: (word: string) => void
  removeLabel: string
  /** The word whose "×" was just clicked — shows a spinner in its place until
   * the removal commits. Only ever meaningful alongside `onRemoveWord`, so it
   * lives here rather than as its own top-level prop like `justAddedWord`. */
  removingWord: string | null
}

export function ChartRenderer({
  chart,
  compact = false,
  wordCloudEditing,
  justAddedWord,
}: {
  chart: ChartData
  compact?: boolean
  wordCloudEditing?: WordCloudEditing
  /** The word from the most recent successful search — plays an entrance
   * animation on just that bubble, in the hero cloud and in whichever
   * participant clouds it also landed in. Independent of `wordCloudEditing`
   * since a participant cloud gets this without becoming removable. */
  justAddedWord?: string | null
}) {
  switch (chart.kind) {
    case 'bar':
      return <BarRanking items={chart.items} compact={compact} />
    case 'histogram':
      return <BarRanking items={chart.buckets} compact={compact} />
    case 'donut':
      return <Donut items={chart.items} />
    case 'hourHeatmap':
      return <HourHeatmap hours={chart.hours} peakPeriodLabel={chart.peakPeriodLabel} unit={chart.unit} />
    case 'yearHeatmap':
      return <YearHeatmap days={chart.days} unit={chart.unit} />
    case 'monthHeatmap':
      return <MonthHeatmap months={chart.months} unit={chart.unit} />
    case 'radar':
      return <RadarChart axes={chart.axes} />
    case 'calendarStreak':
      return <CalendarStreak streaks={chart.streaks} unit={chart.unit} />
    case 'timeline':
      return <Timeline points={chart.points} />
    case 'activityWave':
      return <ActivityWave points={chart.points} />
    case 'wordCloud':
      return (
        <WordCloud
          words={chart.words}
          unit={chart.unit}
          compact={compact}
          onRemoveWord={wordCloudEditing?.onRemoveWord}
          removeLabel={wordCloudEditing?.removeLabel}
          removingWord={wordCloudEditing?.removingWord}
          justAddedWord={justAddedWord}
        />
      )
    default:
      return null
  }
}
