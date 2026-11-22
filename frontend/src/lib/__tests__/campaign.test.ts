import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureCampaignFromLocation, clearStoredCampaign, readCampaignPath, readStoredCampaign } from '../campaign'

describe('links de campaña', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it('reconoce sólo /q/{código}', () => {
    expect(readCampaignPath('/q/ab3k9x')).toBe('ab3k9x')
    expect(readCampaignPath('/q/AB3K9X/')).toBe('ab3k9x')
    expect(readCampaignPath('/q/')).toBeNull()
    expect(readCampaignPath('/q/ab3k9x/otra')).toBeNull()
    expect(readCampaignPath('/s/ab3k9x')).toBeNull()
  })

  it('guarda el código, deja la URL en la página principal y avisa la visita', () => {
    window.history.replaceState(null, '', '/q/ab3k9x?lang=es')

    expect(captureCampaignFromLocation()).toBe('ab3k9x')

    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('?lang=es')
    expect(readStoredCampaign()).toBe('ab3k9x')
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/campaigns\/visit$/)
    expect(JSON.parse(init.body as string)).toMatchObject({ code: 'ab3k9x' })
  })

  it('fuera de un link de campaña no hace nada', () => {
    window.history.replaceState(null, '', '/cuenta')

    expect(captureCampaignFromLocation()).toBeNull()

    expect(window.location.pathname).toBe('/cuenta')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('un código viejo ya no se atribuye', () => {
    localStorage.setItem('vistazo-campaign', JSON.stringify({ code: 'ab3k9x', at: Date.now() - 31 * 24 * 60 * 60 * 1000 }))

    expect(readStoredCampaign()).toBeNull()
  })

  it('después del login se olvida', () => {
    window.history.replaceState(null, '', '/q/ab3k9x')
    captureCampaignFromLocation()

    clearStoredCampaign()

    expect(readStoredCampaign()).toBeNull()
  })
})
