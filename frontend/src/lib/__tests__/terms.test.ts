import { describe, expect, it } from 'vitest'
import type { UserProfile } from '../../types'
import { needsTermsAcceptance, TERMS_VERSION, termsUpdatedOn } from '../terms'

const user = { id: 'u1', email: 'a@example.com' } as UserProfile

describe('needsTermsAcceptance', () => {
  it('sin sesión no se pide nada', () => {
    expect(needsTermsAcceptance(null)).toBe(false)
  })

  it('una cuenta que nunca aceptó, o con un perfil guardado antes de que existiera el campo, los tiene que aceptar', () => {
    expect(needsTermsAcceptance({ ...user, acceptedTermsVersion: null })).toBe(true)
    expect(needsTermsAcceptance(user)).toBe(true)
  })

  it('una cuenta que aceptó otra edición los vuelve a aceptar', () => {
    expect(needsTermsAcceptance({ ...user, acceptedTermsVersion: '2020-01-01' })).toBe(true)
  })

  it('una cuenta que aceptó esta edición no ve el cartel', () => {
    expect(needsTermsAcceptance({ ...user, acceptedTermsVersion: TERMS_VERSION })).toBe(false)
  })
})

describe('TERMS_VERSION', () => {
  it('es una fecha, que es lo único que el backend acepta', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(termsUpdatedOn()).toMatch(/\d{4}$/)
  })
})
