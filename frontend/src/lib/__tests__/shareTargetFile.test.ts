import { beforeEach, describe, expect, it, vi } from 'vitest'
import { takeSharedFile } from '../shareTargetFile'

/**
 * Doble mínimo de IndexedDB.
 *
 * No se usa `fake-indexeddb` a propósito: clona los valores con el `structuredClone`
 * de Node, que no sabe preservar un `File` — sale del store convertido en `{}`. El
 * navegador sí lo preserva, así que un test montado sobre esa librería probaría lo
 * contrario de lo que pasa en producción, justo en la rama (`stored instanceof File`)
 * que existe para leer lo que guardaba una versión vieja de `sw.js`. Este doble guarda
 * por referencia y además permite forzar los errores de apertura y lectura, que con la
 * librería real no hay forma de provocar.
 */
interface Stub {
  store: Map<string, unknown>
  openError: Error | null
  getError: Error | null
  closed: number
  upgraded: boolean
}

let stub: Stub

function installIndexedDbStub() {
  stub = { store: new Map(), openError: null, getError: null, closed: 0, upgraded: false }

  const fakeIndexedDb = {
    open() {
      const request: Record<string, unknown> = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }

      queueMicrotask(() => {
        if (stub.openError) {
          request.error = stub.openError
          ;(request.onerror as (() => void) | null)?.()
          return
        }

        request.result = {
          createObjectStore: () => {
            stub.upgraded = true
          },
          close: () => {
            stub.closed += 1
          },
          transaction: () => ({
            objectStore: () => ({
              get(key: string) {
                const getRequest: Record<string, unknown> = { result: undefined, error: null, onsuccess: null, onerror: null }
                queueMicrotask(() => {
                  if (stub.getError) {
                    getRequest.error = stub.getError
                    ;(getRequest.onerror as (() => void) | null)?.()
                    return
                  }
                  getRequest.result = stub.store.get(key)
                  ;(getRequest.onsuccess as (() => void) | null)?.()
                })
                return getRequest
              },
              delete(key: string) {
                stub.store.delete(key)
              },
            }),
          }),
        }

        // La primera apertura crea el object store, igual que la base real.
        ;(request.onupgradeneeded as (() => void) | null)?.()
        ;(request.onsuccess as (() => void) | null)?.()
      })

      return request
    },
  }

  vi.stubGlobal('indexedDB', fakeIndexedDb)
}

beforeEach(installIndexedDbStub)

describe('takeSharedFile', () => {
  it('devuelve file en null cuando no hubo ningún share', async () => {
    await expect(takeSharedFile()).resolves.toEqual({ file: null })
  })

  it('crea el object store en la primera apertura', async () => {
    await takeSharedFile()

    expect(stub.upgraded).toBe(true)
  })

  it('devuelve el archivo y el diagnóstico que dejó el service worker', async () => {
    const file = new File(['contenido'], 'chat.txt')
    stub.store.set('pending', { file, debug: { name: 'chat.txt', size: 9 } })

    const record = await takeSharedFile()

    expect(record.file).toBe(file)
    expect(record.debug).toEqual({ name: 'chat.txt', size: 9 })
  })

  it('consume el archivo: una segunda lectura ya no lo encuentra', async () => {
    stub.store.set('pending', { file: new File(['x'], 'chat.txt') })

    await takeSharedFile()

    expect(stub.store.has('pending')).toBe(false)
    await expect(takeSharedFile()).resolves.toEqual({ file: null })
  })

  it('borra el registro incluso cuando no había archivo, para no dejar fantasmas', async () => {
    stub.store.set('pending', { file: null, debug: { error: 'sin archivo' } })

    await takeSharedFile()

    expect(stub.store.has('pending')).toBe(false)
  })

  it('acepta el formato viejo, con el File suelto sin envolver', async () => {
    const file = new File(['contenido'], 'viejo.txt')
    stub.store.set('pending', file)

    const record = await takeSharedFile()

    expect(record.file).toBe(file)
    expect(record.debug).toBeUndefined()
  })

  it('devuelve el diagnóstico aunque el archivo no haya llegado', async () => {
    stub.store.set('pending', { file: null, debug: { error: 'no files in formData' } })

    const record = await takeSharedFile()

    expect(record.file).toBeNull()
    expect(record.debug).toEqual({ error: 'no files in formData' })
  })

  it('cierra la conexión después de leer', async () => {
    await takeSharedFile()

    expect(stub.closed).toBe(1)
  })

  it('propaga el error de apertura de la base', async () => {
    stub.openError = new Error('quota exceeded')

    await expect(takeSharedFile()).rejects.toThrow('quota exceeded')
  })

  it('propaga el error de lectura', async () => {
    stub.getError = new Error('read failed')

    await expect(takeSharedFile()).rejects.toThrow('read failed')
  })
})
