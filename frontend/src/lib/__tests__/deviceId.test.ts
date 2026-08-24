import { describe, expect, it, vi } from 'vitest'
import { getDeviceId } from '../deviceId'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('getDeviceId', () => {
  it('genera un UUID la primera vez y lo persiste', () => {
    const id = getDeviceId()

    expect(id).toMatch(UUID)
    expect(localStorage.getItem('vistazo-device-id')).toBe(id)
  })

  it('devuelve siempre el mismo id en llamadas sucesivas', () => {
    expect(getDeviceId()).toBe(getDeviceId())
  })

  it('respeta un id ya guardado en vez de pisarlo', () => {
    localStorage.setItem('vistazo-device-id', 'id-preexistente')

    expect(getDeviceId()).toBe('id-preexistente')
  })

  it('en modo incógnito devuelve un id de sesión en vez de romper', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    const id = getDeviceId()

    expect(id).toMatch(UUID)
  })

  it('con el storage bloqueado el id no se persiste (y por eso cambia)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(getDeviceId()).not.toBe(getDeviceId())
  })
})
