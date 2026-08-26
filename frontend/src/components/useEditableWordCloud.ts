import { useEffect, useMemo, useState } from 'react'
import { countWordOccurrences } from '../lib/metrics'
import type { ChartData, ChatMessage, WordCloudDatum } from '../types'

export interface WordCloudSearchCopy {
  emptyQuery: string
  alreadyShown: string
  notFound: string
  noAccess: string
}

/**
 * Shared editing state for the one word cloud that's worth editing: the
 * aggregate chart in the "wordcloud" metric's hero (see `metricWordcloud` in
 * lib/metrics.ts). Both shells (MetricModal for desktop, MetricSheet for
 * mobile) use this instead of duplicating the merge/search logic the way they
 * already duplicate `filterWordCloud`.
 *
 * `messages` is the raw chat — only ever present for the chat currently open
 * in this browser tab. A saved analysis from history or a shared story link
 * never carries it (only the precomputed cards do, by design — see the
 * privacy note in the landing copy), so search there can only report
 * `noAccess` instead of a real count.
 */
export function useEditableWordCloud({
  chart,
  messages,
  resetKey,
  copy,
}: {
  chart: ChartData | undefined
  messages: ChatMessage[] | undefined
  /** Cleared whenever this changes — pass the metric card's id so switching
   * cards (or reopening one) doesn't carry over another metric's edits. */
  resetKey: string
  copy: WordCloudSearchCopy
}) {
  const [removedWords, setRemovedWords] = useState<Set<string>>(new Set())
  const [addedWords, setAddedWords] = useState<WordCloudDatum[]>([])
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [searchError, setSearchError] = useState('')

  useEffect(() => {
    setRemovedWords(new Set())
    setAddedWords([])
    setSelectedWord(null)
    setSearchError('')
  }, [resetKey])

  const baseWords = chart?.kind === 'wordCloud' ? chart.words : []

  const displayChart = useMemo<ChartData | undefined>(() => {
    if (!chart || chart.kind !== 'wordCloud') {
      return chart
    }
    const merged = [...baseWords, ...addedWords].filter((word) => !removedWords.has(word.word))
    return { kind: 'wordCloud', words: merged, unit: chart.unit }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, addedWords, removedWords])

  function onWordClick(word: string) {
    setSelectedWord((current) => (current === word ? null : word))
  }

  function onDeselect() {
    setSelectedWord(null)
  }

  function onRemoveWord(word: string) {
    setRemovedWords((current) => new Set(current).add(word))
    setAddedWords((current) => current.filter((item) => item.word !== word))
    setSelectedWord(null)
  }

  /** Returns whether the word was added, so the caller can decide whether to
   * clear the search box. */
  function searchAndAdd(rawQuery: string): boolean {
    const query = rawQuery.trim().toLowerCase()
    if (!query) {
      setSearchError(copy.emptyQuery)
      return false
    }

    const alreadyVisible = [...baseWords, ...addedWords].some(
      (item) => item.word === query && !removedWords.has(item.word),
    )
    if (alreadyVisible) {
      setSearchError(copy.alreadyShown)
      return false
    }

    if (!messages) {
      setSearchError(copy.noAccess)
      return false
    }

    const count = countWordOccurrences(messages, query)
    if (count === 0) {
      setSearchError(copy.notFound)
      return false
    }

    setAddedWords((current) => [...current, { word: query, count }])
    setRemovedWords((current) => {
      if (!current.has(query)) {
        return current
      }
      const next = new Set(current)
      next.delete(query)
      return next
    })
    setSearchError('')
    return true
  }

  function clearSearchError() {
    setSearchError('')
  }

  return {
    displayChart,
    selectedWord,
    searchError,
    onWordClick,
    onDeselect,
    onRemoveWord,
    searchAndAdd,
    clearSearchError,
  }
}
