import { describe, expect, it } from 'vitest'
import { TERMS_OWNER, TERMS_SECTIONS } from '../termsText'

const text = TERMS_SECTIONS.flatMap((section) => section.blocks.flat()).join('\n')

describe('termsText', () => {
  it('no obliga a publicar datos personales: sin nombre ni CUIT, el texto no los menciona ni deja huecos', () => {
    expect(TERMS_OWNER.name).toBe('')
    expect(TERMS_OWNER.cuit).toBe('')
    expect(text).not.toMatch(/CUIT/)
    expect(text).not.toMatch(/\[COMPLETAR: (nombre|CUIT)/)
  })

  it('con el titular sin nombrar, dice a quién se le informa su identidad', () => {
    expect(TERMS_SECTIONS[0].blocks[0]).toMatch(/autoridades competentes/)
  })

  it('no publica ningún mail del titular: el contacto es la página de ayuda, y no queda ningún hueco por completar', () => {
    expect(text).not.toMatch(/\[COMPLETAR/)
    expect(text).not.toMatch(/\S+@\S+/)
    expect(TERMS_SECTIONS[0].blocks[1]).toMatch(/página de ayuda/)
    expect(text).not.toMatch(/ayuda o por mail/)
  })

  it('nunca incluye un domicilio particular', () => {
    expect(text).not.toMatch(/domicilio (real|particular|legal en)/i)
  })

  it('todas las secciones tienen título y contenido', () => {
    for (const section of TERMS_SECTIONS) {
      expect(section.title.trim()).not.toBe('')
      expect(section.blocks.length).toBeGreaterThan(0)
    }
  })
})
