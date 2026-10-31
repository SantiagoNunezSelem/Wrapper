import { describe, expect, it } from 'vitest'
import { formatMoney, formatTrialLength, splitLeadingEmoji } from '../format'

describe('formatMoney', () => {
  it('formatea pesos argentinos sin decimales', () => {
    // El separador de miles de es-AR es un punto; el símbolo puede venir con espacio
    // normal o angosto según la versión de ICU, así que se compara lo que importa.
    const formatted = formatMoney(7900, 'ARS', 'es-AR')

    expect(formatted).toContain('7.900')
    expect(formatted).toMatch(/\$/)
    expect(formatted).not.toContain(',00')
  })

  it('formatea dólares en inglés', () => {
    expect(formatMoney(1234, 'USD', 'en-US')).toBe('$1,234')
  })

  it('redondea en vez de mostrar centavos', () => {
    expect(formatMoney(1234.56, 'USD', 'en-US')).toBe('$1,235')
  })

  it('formatea el cero', () => {
    expect(formatMoney(0, 'USD', 'en-US')).toBe('$0')
  })

  it('formatea importes negativos', () => {
    expect(formatMoney(-50, 'USD', 'en-US')).toBe('-$50')
  })

  it('cae a texto plano cuando la moneda no existe, en vez de romper la pantalla', () => {
    expect(formatMoney(500, 'NOPE', 'es-AR')).toBe('500 NOPE')
  })

  it('cae a texto plano cuando el locale es inválido', () => {
    expect(formatMoney(500, 'ARS', 'no-es-un-locale!')).toBe('500 ARS')
  })
})

describe('splitLeadingEmoji', () => {
  it('separa el emoji inicial del resto', () => {
    expect(splitLeadingEmoji('😂 ×1.243')).toEqual({ emoji: '😂', rest: '×1.243' })
  })

  it('se lleva también el selector de variación', () => {
    expect(splitLeadingEmoji('❤️ ×3')).toEqual({ emoji: '❤️', rest: '×3' })
  })

  it('funciona sin espacio entre el emoji y el texto', () => {
    expect(splitLeadingEmoji('🔥12')).toEqual({ emoji: '🔥', rest: '12' })
  })

  it('devuelve null cuando el texto no arranca con emoji', () => {
    expect(splitLeadingEmoji('Hora pico: Noche')).toEqual({ emoji: null, rest: 'Hora pico: Noche' })
  })

  it('ignora un emoji que no está al principio', () => {
    expect(splitLeadingEmoji('top 😂')).toEqual({ emoji: null, rest: 'top 😂' })
  })

  it('maneja el string vacío', () => {
    expect(splitLeadingEmoji('')).toEqual({ emoji: null, rest: '' })
  })

  it('separa un solo emoji sin resto', () => {
    expect(splitLeadingEmoji('🎉')).toEqual({ emoji: '🎉', rest: '' })
  })
})

describe('formatTrialLength', () => {
  it('escribe los días del plan en el idioma de la pantalla', () => {
    expect(formatTrialLength(7, 'days', 'es-AR')).toBe('7 días')
    expect(formatTrialLength(14, 'days', 'en-US')).toBe('14 days')
  })

  it('usa el singular cuando es uno solo', () => {
    expect(formatTrialLength(1, 'days', 'en-US')).toBe('1 day')
  })

  it('entiende un plan que mide la prueba en meses', () => {
    expect(formatTrialLength(2, 'months', 'en-US')).toBe('2 months')
  })

  it('cae a un texto plano si el locale no es válido', () => {
    expect(formatTrialLength(7, 'days', 'no-es-un-locale!')).toBe('7 days')
  })
})
