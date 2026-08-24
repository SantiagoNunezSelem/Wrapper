import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../hash'

describe('sha256Hex', () => {
  it('devuelve el digest conocido del string vacío', async () => {
    await expect(sha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('devuelve el digest conocido de "abc"', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('siempre devuelve 64 caracteres hexadecimales en minúscula', async () => {
    const digest = await sha256Hex('Vistazo — análisis de chat')
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rellena con cero los bytes de un solo dígito en vez de acortarlos', async () => {
    // "eb" es un digest que arranca con 0x0b: sin el padStart(2,'0') saldría de 63.
    const digests = await Promise.all(
      Array.from({ length: 40 }, (_, index) => sha256Hex(`padding-probe-${index}`)),
    )
    for (const digest of digests) {
      expect(digest).toHaveLength(64)
    }
  })

  it('es sensible a cambios de un solo carácter', async () => {
    const [first, second] = await Promise.all([sha256Hex('hola'), sha256Hex('hol4')])
    expect(first).not.toBe(second)
  })

  it('codifica como UTF-8, no como latin-1', async () => {
    // Si el TextEncoder no fuera UTF-8, "ñ" y "n" darían el mismo digest truncado.
    const [accented, plain] = await Promise.all([sha256Hex('ñ'), sha256Hex('n')])
    expect(accented).not.toBe(plain)
    // Digest UTF-8 real de "ñ" (0xC3 0xB1).
    expect(accented).toBe('024bb90888ca89a15a19e9bdd8c712bfb070465fce1ef25e43c170ea44fc5e5f')
  })
})
