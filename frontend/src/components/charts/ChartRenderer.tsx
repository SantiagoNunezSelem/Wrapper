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

export function ChartRenderer({ chart, compact = false }: { chart: ChartData; compact?: boolean }) {
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
      return <WordCloud words={chart.words} unit={chart.unit} compact={compact} />
    default:
      return null
  }
}
