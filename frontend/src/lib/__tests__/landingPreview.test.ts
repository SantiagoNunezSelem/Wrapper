import { describe, expect, it } from 'vitest'
import { getLandingPreviewCards } from '../landingPreview'

describe('getLandingPreviewCards', () => {
  it('devuelve tarjetas de ejemplo en los dos idiomas', () => {
    expect(getLandingPreviewCards('es').length).toBeGreaterThan(0)
    expect(getLandingPreviewCards('en')).toHaveLength(getLandingPreviewCards('es').length)
  })

  it('ninguna tarjeta de ejemplo se renderiza bloqueada', () => {
    for (const language of ['es', 'en'] as const) {
      for (const card of getLandingPreviewCards(language)) {
        expect(card.hasData, `${card.id} (${language}).hasData`).toBe(true)
        expect(card.basic, `${card.id} (${language}).basic`).toBeDefined()
        expect(card.detail, `${card.id} (${language}).detail`).toBeDefined()
      }
    }
  })

  it('ninguna tarjeta de ejemplo queda esperando a la IA', () => {
    for (const card of getLandingPreviewCards('es')) {
      expect(card.ai, `${card.id}.ai`).toBeUndefined()
    }
  })

  it('los ids son únicos y están marcados como demo', () => {
    const ids = getLandingPreviewCards('es').map((card) => card.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('demo-'))).toBe(true)
  })

  it('los ids no chocan con los de las métricas reales', () => {
    // Un id compartido haría que un desbloqueo gratuito de la landing "abriera"
    // una métrica real, o al revés.
    const ids = getLandingPreviewCards('es').map((card) => card.id)

    expect(ids).not.toContain('spammer')
    expect(ids).not.toContain('monologuista')
  })

  it('cada tarjeta trae número, etiqueta y teaser', () => {
    for (const card of getLandingPreviewCards('es')) {
      expect(card.basic?.value, `${card.id}.value`).toBeTruthy()
      expect(card.basic?.label, `${card.id}.label`).toBeTruthy()
      expect(card.preview, `${card.id}.preview`).toBeTruthy()
      expect(card.accent, `${card.id}.accent`).toMatch(/^tier-/)
    }
  })

  it('el texto cambia entre español e inglés', () => {
    const es = getLandingPreviewCards('es')
    const en = getLandingPreviewCards('en')

    for (let index = 0; index < es.length; index += 1) {
      expect(en[index].id).toBe(es[index].id)
      expect(en[index].title, `${es[index].id}.title`).not.toBe(es[index].title)
    }
  })

  it('los datos son inventados: no hay ningún hash ni nombre de chat real', () => {
    const serialized = JSON.stringify(getLandingPreviewCards('es'))

    expect(serialized).not.toMatch(/[0-9a-f]{64}/)
  })
})
