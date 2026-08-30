import { useEffect, useMemo, useState } from 'react'
import { searchWordInWorker } from '../lib/analysisClient'
import type { ChartData, ChatMessage, MetricSeriesEntry, WordCloudDatum } from '../types'

export interface WordCloudSearchCopy {
  emptyQuery: string
  alreadyShown: string
  notFound: string
  noAccess: string
  searchFailed: string
}

/** How long a removal stays "in flight" before it actually disappears — long enough
 * to read as a deliberate, confirmed action instead of an instant flash, and short
 * enough that it never feels like the click didn't register. There's no real work to
 * await here (unlike a search), so this is the only busy time this operation has. */
const REMOVE_DELAY_MS = 350

/**
 * Shared editing state for the wordcloud metric's search box (see
 * `metricWordcloud` in lib/metrics.ts). Both shells (MetricModal for desktop,
 * MetricSheet for mobile) use this instead of duplicating the merge/search
 * logic.
 *
 * A found word lands in two places at once: the combined hero cloud (with its
 * chat-wide count), and every participant's own cloud below it (each with
 * *that person's* count) — the whole point of searching a word is comparing
 * who actually said it, not just confirming it exists somewhere. Removing it
 * is hero-only and cascades everywhere, via `removedWords`; the per-participant
 * clouds themselves stay read-only (see WordCloud's `onRemoveWord`).
 *
 * The count itself comes from the analysis worker, not a local scan — a search
 * counts once across the whole chat plus once per participant, and doing that
 * synchronously on the main thread is exactly the kind of chat-wide pass this
 * app already keeps off it (see analysisWorker.ts).
 *
 * `messages` is the raw chat — only ever present for the chat currently open
 * in this browser tab. A saved analysis from history or a shared story link
 * never carries it (only the precomputed cards do, by design — see the
 * privacy note in the landing copy), so search there can only report
 * `noAccess` instead of a real count.
 */
export function useEditableWordCloud({
  chart,
  series,
  messages,
  resetKey,
  copy,
}: {
  chart: ChartData | undefined
  /** The per-participant clouds (`card.detail.series`) — each search also
   * lands in here, with that participant's own count. Omit for a metric with
   * no per-participant breakdown. */
  series?: MetricSeriesEntry[]
  messages: ChatMessage[] | undefined
  /** Cleared whenever this changes — pass the metric card's id so switching
   * cards (or reopening one) doesn't carry over another metric's edits. */
  resetKey: string
  copy: WordCloudSearchCopy
}) {
  const [removedWords, setRemovedWords] = useState<Set<string>>(new Set())
  const [addedWords, setAddedWords] = useState<WordCloudDatum[]>([])
  // Per-participant counts for each added word, keyed by participant name — filled in
  // straight from the worker's response, never recomputed locally (see the hook doc).
  const [addedWordsByParticipant, setAddedWordsByParticipant] = useState<Map<string, WordCloudDatum[]>>(new Map())
  const [searchError, setSearchError] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  // The word currently mid-removal — null the rest of the time. Only ever one at a
  // time: the "×" that started a removal is the only one showing a spinner.
  const [removingWord, setRemovingWord] = useState<string | null>(null)
  // The word from the most recent successful search — lets every cloud it
  // landed in play an entrance animation on just that bubble.
  const [justAddedWord, setJustAddedWord] = useState<string | null>(null)

  useEffect(() => {
    setRemovedWords(new Set())
    setAddedWords([])
    setAddedWordsByParticipant(new Map())
    setSearchError('')
    setIsSearching(false)
    setRemovingWord(null)
    setJustAddedWord(null)
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

  const displaySeries = useMemo<MetricSeriesEntry[] | undefined>(() => {
    if (!series) {
      return series
    }
    return series.map((entry) => {
      if (entry.chart.kind !== 'wordCloud') {
        return entry
      }
      const chart = entry.chart
      // Skip a word this participant's own cloud already has — searching "amor" on
      // a chat where Ana's top words already include it shouldn't double it up just
      // because it also got added to the hero cloud.
      const extra = (addedWordsByParticipant.get(entry.name) ?? []).filter(
        (item) => !chart.words.some((existing) => existing.word === item.word),
      )
      const merged = [...chart.words, ...extra].filter((word) => !removedWords.has(word.word))
      return { name: entry.name, chart: { ...chart, words: merged } }
    })
  }, [series, addedWordsByParticipant, removedWords])

  async function onRemoveWord(word: string) {
    setRemovingWord(word)
    await new Promise((resolve) => setTimeout(resolve, REMOVE_DELAY_MS))

    setRemovedWords((current) => new Set(current).add(word))
    setAddedWords((current) => current.filter((item) => item.word !== word))
    setAddedWordsByParticipant((current) => {
      const next = new Map<string, WordCloudDatum[]>()
      for (const [name, words] of current) {
        next.set(
          name,
          words.filter((item) => item.word !== word),
        )
      }
      return next
    })
    setRemovingWord(null)
  }

  /** Returns whether the word was added, so the caller can decide whether to
   * clear the search box. */
  async function searchAndAdd(rawQuery: string): Promise<boolean> {
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

    setIsSearching(true)
    try {
      const participants = series?.map((entry) => entry.name) ?? []
      const { count, countsByParticipant } = await searchWordInWorker(messages, query, participants)

      if (count === 0) {
        setSearchError(copy.notFound)
        return false
      }

      setAddedWords((current) => [...current, { word: query, count }])
      setAddedWordsByParticipant((current) => {
        const next = new Map(current)
        for (const [name, personCount] of Object.entries(countsByParticipant)) {
          next.set(name, [...(next.get(name) ?? []), { word: query, count: personCount }])
        }
        return next
      })
      setRemovedWords((current) => {
        if (!current.has(query)) {
          return current
        }
        const next = new Set(current)
        next.delete(query)
        return next
      })
      setSearchError('')
      setJustAddedWord(query)
      return true
    } catch {
      setSearchError(copy.searchFailed)
      return false
    } finally {
      setIsSearching(false)
    }
  }

  function clearSearchError() {
    setSearchError('')
  }

  return {
    displayChart,
    displaySeries,
    searchError,
    isSearching,
    removingWord,
    justAddedWord,
    onRemoveWord,
    searchAndAdd,
    clearSearchError,
  }
}
