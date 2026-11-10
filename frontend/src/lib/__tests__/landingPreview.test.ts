import { beforeAll, describe, expect, it } from 'vitest'
import type { MetricCard } from '../../types'
import { buildLandingPreviewCards, demoIdPrefix, landingPreviewMetricIds } from '../landingPreview'
import { buildLandingSampleChat } from '../landingSample'
import { PROFILE_METRIC_ID } from '../metrics'
import { parseChatText } from '../parser'
import { MIN_MESSAGES_PER_PERSON } from '../personality'

// Calcular las métricas sobre el chat de ejemplo cuesta unos segundos en jsdom: una vez
// por idioma para todo el archivo.
const cards: Record<'es' | 'en', MetricCard[]> = { es: [], en: [] }

beforeAll(async () => {
  cards.es = await buildLandingPreviewCards('es')
  cards.en = await buildLandingPreviewCards('en')
}, 60_000)

function cardOf(language: 'es' | 'en', metricId: string): MetricCard {
  const card = cards[language].find((item) => item.id === `${demoIdPrefix}${metricId}`)

  if (!card) {
    throw new Error(`Falta la tarjeta de ejemplo "${metricId}" en ${language}.`)
  }

  return card
}

describe('buildLandingSampleChat', () => {
  it('es determinístico: la landing muestra siempre los mismos números', () => {
    expect(buildLandingSampleChat('es')).toBe(buildLandingSampleChat('es'))
  })

  it('cambia de idioma', () => {
    expect(buildLandingSampleChat('en')).not.toBe(buildLandingSampleChat('es'))
  })

  it('los cuatro tienen mensajes de sobra para que se les lea la personalidad', async () => {
    for (const language of ['es', 'en'] as const) {
      const { messages } = await parseChatText(buildLandingSampleChat(language))
      const texts = new Map<string, number>()

      for (const message of messages) {
        if (message.sender && !message.isSystemPlaceholder && message.contentText.trim().length > 0) {
          texts.set(message.sender, (texts.get(message.sender) ?? 0) + 1)
        }
      }

      expect([...texts.keys()].sort()).toEqual(['Caro', 'Fran', 'Nico', 'Vale'])
      for (const [name, count] of texts) {
        expect(count, `${name} (${language})`).toBeGreaterThanOrEqual(MIN_MESSAGES_PER_PERSON)
      }
    }
  })
})

describe('buildLandingPreviewCards', () => {
  it('son las cinco que se pidieron, en ese orden', () => {
    expect([...landingPreviewMetricIds]).toEqual(['personalidades', 'redflags', 'tonopicante', 'rompehielo', 'clavavistos'])
  })

  it('devuelve todas las métricas elegidas, en orden, en los dos idiomas', () => {
    const expected = landingPreviewMetricIds.map((id) => `${demoIdPrefix}${id}`)

    expect(cards.es.map((card) => card.id)).toEqual(expected)
    expect(cards.en.map((card) => card.id)).toEqual(expected)
  })

  it('ninguna tarjeta de ejemplo se renderiza bloqueada ni esperando a la IA', () => {
    for (const language of ['es', 'en'] as const) {
      for (const card of cards[language]) {
        expect(card.basic, `${card.id} (${language}).basic`).toBeDefined()
        expect(card.detail, `${card.id} (${language}).detail`).toBeDefined()
        expect(card.ai, `${card.id} (${language}).ai`).toBeUndefined()
      }
    }
  })

  it('cada detalle trae algo para leer: mensajes de ejemplo, o el perfil de cada uno en la personalidad', () => {
    for (const card of cards.es) {
      if (card.id === `${demoIdPrefix}${PROFILE_METRIC_ID}`) {
        expect(card.detail?.profiles?.length, `${card.id} profiles`).toBeGreaterThan(0)
        continue
      }

      const bubbles = card.detail?.groups?.flatMap((group) => group.bubbles) ?? []
      expect(bubbles.length, `${card.id} bubbles`).toBeGreaterThan(0)
    }
  })

  it('la personalidad trae el perfil de cada integrante', () => {
    for (const language of ['es', 'en'] as const) {
      const profiles = cardOf(language, PROFILE_METRIC_ID).detail?.profiles ?? []

      expect(profiles.map((profile) => profile.name).sort(), language).toEqual(['Caro', 'Fran', 'Nico', 'Vale'])
    }
  })

  it('Red Flags dibuja una torta por categoría, varias repartidas entre más de uno, y no el "por integrante"', () => {
    for (const language of ['es', 'en'] as const) {
      const detail = cardOf(language, 'redflags').detail
      const series = detail?.series ?? []
      const shared = series.filter((entry) => entry.chart.kind === 'donut' && entry.chart.items.length >= 2)

      expect(series.length, `${language} categorías`).toBeGreaterThanOrEqual(4)
      expect(series.every((entry) => entry.chart.kind === 'donut'), `${language} tortas`).toBe(true)
      expect(shared.length, `${language} tortas repartidas`).toBeGreaterThanOrEqual(3)
      expect(detail?.breakdown, `${language} breakdown`).toBeUndefined()
    }
  })

  it('"Quién tarda más en responder" muestra demoras de una conversación, no días entre una escena y otra', () => {
    for (const language of ['es', 'en'] as const) {
      const card = cardOf(language, 'clavavistos')
      const headings = card.detail?.groups?.map((group) => group.heading) ?? []

      // Caro es la que clava el visto, y su peor demora se cuenta en horas.
      expect(card.basic?.label, language).toContain('Caro')
      expect(card.basic?.note, language).not.toMatch(/d[ií]as?|days?/i)
      expect(headings.length, `${language} demoras`).toBeGreaterThan(0)
      for (const heading of headings) {
        expect(heading, language).not.toMatch(/d[ií]as?|days?/i)
      }
    }
  })

  it('los ids nunca chocan con los de las métricas reales', () => {
    // Un id compartido haría que un desbloqueo gratuito de la landing "abriera"
    // una métrica real, o al revés.
    for (const card of cards.es) {
      expect(card.id.startsWith(demoIdPrefix)).toBe(true)
    }
  })

  it('el texto cambia entre español e inglés', () => {
    // "Red Flags" se dice igual en los dos idiomas: es un préstamo que el español usa tal cual,
    // así que traducirlo solo para que el título "cambie" sería inventar una palabra.
    const sameInBothLanguages = new Set(['Red Flags'])

    for (let index = 0; index < cards.es.length; index += 1) {
      if (sameInBothLanguages.has(cards.es[index].title)) {
        continue
      }

      expect(cards.en[index].title, `${cards.es[index].id}.title`).not.toBe(cards.es[index].title)
    }
  })
})
