import { describe, expect, it } from 'vitest'
import { buildScrubber, letterFor } from '../scrub'

/** Lo que se hace con un texto antes de que salga del navegador: nombres, links, mails y teléfonos. */

describe('letterFor', () => {
  it('A, B, C… por orden', () => {
    expect([0, 1, 2, 25].map(letterFor)).toEqual(['A', 'B', 'C', 'Z'])
  })
})

describe('buildScrubber', () => {
  const letters = new Map([
    ['Ana María', 'A'],
    ['Beto', 'B'],
  ])
  const scrub = buildScrubber(['Ana María', 'Beto', 'Lucho'], letters)

  it('cambia cada nombre por la letra de quien es', () => {
    expect(scrub('Beto me dijo que Ana María no viene')).toBe('B me dijo que A no viene')
  })

  it('cambia también cada palabra suelta del nombre', () => {
    expect(scrub('Ana dijo que no, y María también')).toBe('A dijo que no, y A también')
  })

  it('quien no está en el reparto de letras queda como [otro]', () => {
    expect(scrub('hablé con Lucho')).toBe('hablé con [otro]')
  })

  it('no toca el medio de otra palabra', () => {
    expect(scrub('Betoven toca bien')).toBe('Betoven toca bien')
  })

  it('no distingue mayúsculas', () => {
    expect(scrub('BETO y beto')).toBe('B y B')
  })

  it('saca los links, los mails y los teléfonos', () => {
    // Un link se lleva puesto lo que le sigue pegado, la coma incluida: más vale de más que un link a medias.
    expect(scrub('mirá https://sitio.com/x?y=1 o www.otro.com, escribime a ana@mail.com o al +54 9 11 5555-4444')).toBe(
      'mirá [link] o [link] escribime a [mail] o al [número]',
    )
  })

  it('un texto sin nada que esconder queda igual', () => {
    expect(scrub('hoy comimos pizza')).toBe('hoy comimos pizza')
  })
})
