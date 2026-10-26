import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El módulo guarda en memoria qué videos ya bajó (y cuáles están bajando). Cada test
 * lo recarga para arrancar sin nada precargado.
 */
async function freshModule() {
  vi.resetModules()
  return import('../tutorialVideos')
}

/** Espera a que terminen las promesas de la precarga (fetch → blob → createObjectURL). */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function okResponse() {
  return { ok: true, status: 200, blob: async () => new Blob(['video']) } as Response
}

describe('tutorialVideos', () => {
  const originalCreateObjectURL = URL.createObjectURL
  let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>

  beforeEach(() => {
    let next = 0
    createObjectURL = vi.fn((_blob: Blob) => `blob:video-${next++}`)
    // jsdom no implementa createObjectURL.
    URL.createObjectURL = createObjectURL
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    vi.unstubAllGlobals()
  })

  it('cada paso tiene su video, salvo el de instalar la app y el de subir el archivo en iOS', async () => {
    const { tutorialStepVideo, tutorialVideos } = await freshModule()

    expect(tutorialStepVideo('android', 0)).toBeNull()
    expect(tutorialStepVideo('android', 1)).toBe(tutorialVideos.androidExport)
    expect(tutorialStepVideo('android', 2)).toBe(tutorialVideos.androidShare)
    expect(tutorialStepVideo('ios', 0)).toBe(tutorialVideos.iosExport)
    expect(tutorialStepVideo('ios', 1)).toBeNull()
    // Un paso que no existe no rompe: simplemente no tiene video.
    expect(tutorialStepVideo('ios', 7)).toBeNull()
  })

  it('sin precarga, el video se pide a la red', async () => {
    const { tutorialVideoUrl, tutorialVideos } = await freshModule()

    expect(tutorialVideoUrl(tutorialVideos.iosExport.src)).toBe(tutorialVideos.iosExport.src)
  })

  it('precarga los videos de las dos plataformas y después los sirve desde memoria', async () => {
    const fetchMock = vi.fn(async (_src: string) => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { preloadTutorialVideos, tutorialVideoUrl, tutorialVideos } = await freshModule()

    preloadTutorialVideos()
    await settle()

    const sources = Object.values(tutorialVideos).map((video) => video.src)
    expect(fetchMock.mock.calls.map(([src]) => src)).toEqual(sources)
    for (const src of sources) {
      expect(tutorialVideoUrl(src)).toMatch(/^blob:/)
    }
  })

  it('llamarla de nuevo no vuelve a bajar lo que ya está o se está bajando', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { preloadTutorialVideos, tutorialVideos } = await freshModule()
    const count = Object.keys(tutorialVideos).length

    preloadTutorialVideos()
    preloadTutorialVideos()
    expect(fetchMock).toHaveBeenCalledTimes(count)

    await settle()
    preloadTutorialVideos()
    expect(fetchMock).toHaveBeenCalledTimes(count)
  })

  it('si la descarga falla, el video se sigue pidiendo a la red y se puede reintentar', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { preloadTutorialVideos, tutorialVideoUrl, tutorialVideos } = await freshModule()

    preloadTutorialVideos()
    await settle()

    expect(tutorialVideoUrl(tutorialVideos.androidShare.src)).toBe(tutorialVideos.androidShare.src)
    expect(createObjectURL).not.toHaveBeenCalled()

    preloadTutorialVideos()
    expect(fetchMock).toHaveBeenCalledTimes(Object.keys(tutorialVideos).length * 2)
  })

  it('sin fetch no intenta nada', async () => {
    vi.stubGlobal('fetch', undefined)
    const { preloadTutorialVideos, tutorialVideoUrl, tutorialVideos } = await freshModule()

    expect(() => preloadTutorialVideos()).not.toThrow()
    expect(tutorialVideoUrl(tutorialVideos.iosExport.src)).toBe(tutorialVideos.iosExport.src)
  })
})
