import { beforeAll, describe, expect, it } from 'vitest'
import type { MetricCard } from '../../types'
import { buildLandingPreviewCards, demoIdPrefix, landingPreviewMetricIds } from '../landingPreview'
import { buildLandingSampleChat } from '../landingSample'

// Calcular las métricas sobre el chat de ejemplo cuesta unos segundos en jsdom: una vez
// por idioma para todo el archivo.
const cards: Record<'es' | 'en', MetricCard[]> = { es: [], en: [] }

beforeAll(async () => {
  cards.es = await buildLandingPreviewCards('es')
  cards.en = await buildLandingPreviewCards('en')
}, 60_000)

describe('buildLandingSampleChat', () => {
  it('es determinístico: la landing muestra siempre los mismos números', () => {
    expect(buildLandingSampleChat('es')).toBe(buildLandingSampleChat('es'))
  })

  it('cambia de idioma', () => {
    expect(buildLandingSampleChat('en')).not.toBe(buildLandingSampleChat('es'))
  })
})

describe('buildLandingPreviewCards', () => {
  it('devuelve todas las métricas elegidas, en orden, en los dos idiomas', () => {
    const expected = landingPreviewMetricIds.map((id) => `${demoIdPrefix}${id}`)

    expect(cards.es.map((card) => card.id)).toEqual(expected)
    expect(cards.en.map((card) => card.id)).toEqual(expected)
  })

  it('intercala métricas gratis y Pro', () => {
    const tiers = new Set(cards.es.map((card) => card.tier))

    expect(tiers).toEqual(new Set(['free', 'vip']))
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

  it('cada detalle trae mensajes de ejemplo adentro', () => {
    for (const card of cards.es) {
      const bubbles = card.detail?.groups?.flatMap((group) => group.bubbles) ?? []
      expect(bubbles.length, `${card.id} bubbles`).toBeGreaterThan(0)
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
    for (let index = 0; index < cards.es.length; index += 1) {
      expect(cards.en[index].title, `${cards.es[index].id}.title`).not.toBe(cards.es[index].title)
    }
  })
})
