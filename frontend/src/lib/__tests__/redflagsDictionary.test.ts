import { describe, expect, it } from 'vitest'
import {
  dictionaryTexts,
  matchAiKeywordExplicit,
  matchAiKeywordGeneral,
  matchAiKeywordWide,
  redFlagCategoryByScanCode,
  redFlagCategoryCount,
  redFlagCategoryIndexOfPhrase,
  redFlagScanCodes,
} from '../metrics'

/**
 * Lo que el diccionario de red flags aprendió después de los primeros: las letras estiradas, las
 * comillas curvas, los insultos que faltaban y las familias de manipulación — que casi nunca traen
 * una palabra que sea un insulto por sí sola.
 */

describe('dictionaryTexts — las formas en que se lee un texto', () => {
  it('un texto sin letras repetidas se lee de una sola forma, sin tildes ni mayúsculas', () => {
    expect(dictionaryTexts('Qué tal')).toEqual(['que tal'])
  })

  it('una letra estirada se lee también aplastada', () => {
    expect(dictionaryTexts('Pelotudooo')).toContain('pelotudo')
    expect(dictionaryTexts('IDIOTAAAA')).toEqual(expect.arrayContaining(['idiotaaaa', 'idiota', 'idiotaa']))
  })

  it('una letra final duplicada se lee también simple', () => {
    expect(dictionaryTexts('boludoo')).toEqual(expect.arrayContaining(['boludoo', 'boludo']))
  })

  it('una palabra que de verdad termina en doble letra sigue leyéndose como es', () => {
    expect(dictionaryTexts('what an ass')).toEqual(expect.arrayContaining(['what an ass']))
    expect(dictionaryTexts('assss')).toEqual(expect.arrayContaining(['assss', 'as', 'ass']))
  })

  it('las comillas curvas de un iPhone son las mismas que las rectas', () => {
    expect(dictionaryTexts('you’re a bitch')[0]).toBe("you're a bitch")
  })

  it('el mismo texto devuelve el mismo resultado sin rehacerlo', () => {
    expect(dictionaryTexts('hola jajaja')).toBe(dictionaryTexts('hola jajaja'))
  })
})

describe('el diccionario entiende lo estirado', () => {
  it('un insulto dirigido con la letra final estirada', () => {
    expect(matchAiKeywordGeneral('redflags', 'sos re pelotudooooo')).toBe('sos re pelotudo')
  })

  it('un insulto suelto estirado llega al nivel ancho', () => {
    expect(matchAiKeywordWide('redflags', 'IDIOTAAAA')).toBe('idiota')
    expect(matchAiKeywordWide('redflags', 'boludoo')).toBe('boludo')
  })

  it('también en tonopicante', () => {
    expect(matchAiKeywordExplicit('tonopicante', 'mostrame el culooooo')).toBe('culo')
  })

  it('las comillas curvas no impiden reconocer una frase en inglés', () => {
    expect(matchAiKeywordExplicit('redflags', 'you’re a bitch')).toBe("you're a bitch")
  })
})

describe('lo que faltaba', () => {
  it.each([
    ['hdp', 'hdp'],
    ['sos un hijo de puta', 'hijo de puta'],
    ['andate a la mierda', 'andate a la mierda'],
    ['sos un conchudo', 'sos un conchudo'],
    ['fuck you', 'fuck you'],
  ])('insultos: "%s"', (text, phrase) => {
    expect(matchAiKeywordExplicit('redflags', text)).toBe(phrase)
  })

  it.each([
    ['pasame tu ubicacion ahora', 'pasame tu ubicacion'],
    ['por que le diste like a esa foto', 'por que le diste like'],
    ['dame tu contraseña', 'dame tu contrasena'],
    ['estabas en linea y no me contestaste', 'estabas en linea y no me contestaste'],
  ])('celos y control: "%s"', (text, phrase) => {
    expect(matchAiKeywordExplicit('redflags', text)).toBe(phrase)
  })

  it.each([
    ['si me quisieras de verdad no te irías', 'si me quisieras'],
    ['después de todo lo que hice por vos', 'despues de todo lo que hice por vos'],
    ['me voy a matar', 'me voy a matar'],
    ['eso nunca pasó', 'eso nunca paso'],
    ['te lo inventaste todo', 'te lo inventaste'],
    ['tus amigas no te quieren', 'tus amigas no te quieren'],
    ['o ellas o yo', 'o ellas o yo'],
    ['te voy a matar', 'te voy a matar'],
    ['voy a subir tus fotos', 'voy a subir tus fotos'],
    ['si me queres lo haces', 'si me queres lo haces'],
    ['nadie se va a enterar', 'nadie se va a enterar'],
  ])('manipulación: "%s"', (text, phrase) => {
    expect(matchAiKeywordExplicit('redflags', text)).toBe(phrase)
  })

  it('las frases cotidianas ambiguas quedan en el nivel ancho, no en el fuerte', () => {
    // "estás loca" lo dicen las amigas todo el día: cuenta, pero no es de lo que más vale juzgar primero.
    expect(matchAiKeywordExplicit('redflags', 'estas loca jaja')).toBeNull()
    expect(matchAiKeywordGeneral('redflags', 'estas loca jaja')).toBe('estas loca')
  })

  it('una conversación normal no dispara nada', () => {
    for (const text of ['que buena la peli', 'nos vemos a las 9', 'te mando la ubicacion del lugar', 'si queres vamos']) {
      expect(matchAiKeywordExplicit('redflags', text)).toBeNull()
      expect(matchAiKeywordGeneral('redflags', text)).toBeNull()
    }
  })
})

describe('las categorías y lo que la lectura contesta', () => {
  it('son nueve, y cada una tiene su código de tres letras', () => {
    expect(redFlagCategoryCount).toBe(9)
    expect(redFlagScanCodes().map((entry) => entry.code)).toEqual(['cel', 'cul', 'ins', 'rup', 'cha', 'gas', 'ais', 'ame', 'pre'])
  })

  it('los códigos son los mismos que conoce el servidor', () => {
    // Mismo conjunto que `AiMetricPrompts.ScanCodes` en el backend: si uno cambia, el otro tiene que cambiar.
    expect(redFlagScanCodes().map((entry) => entry.code).sort()).toEqual(
      ['ais', 'ame', 'cel', 'cha', 'cul', 'gas', 'ins', 'pre', 'rup'],
    )
  })

  it('cada código lleva a su categoría y uno desconocido a ninguna', () => {
    expect(redFlagCategoryByScanCode('cha')).toBe('blackmail')
    expect(redFlagCategoryByScanCode('ame')).toBe('threats')
    expect(redFlagCategoryByScanCode('xyz')).toBeNull()
    expect(redFlagCategoryByScanCode('')).toBeNull()
  })

  it('una frase del diccionario sabe a qué categoría pertenece', () => {
    expect(redFlagCategoryIndexOfPhrase('me dejaste en visto')).toBe(0)
    expect(redFlagCategoryIndexOfPhrase('si me quisieras')).toBeGreaterThan(3)
    expect(redFlagCategoryIndexOfPhrase('esto no está en ningún diccionario')).toBeNull()
  })
})
