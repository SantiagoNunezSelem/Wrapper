import '@testing-library/jest-dom/vitest'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * jsdom no implementa `matchMedia`, y la app la consulta en tres lugares distintos
 * (`useIsMobile`, `usePwaInstall`, `prefersReducedMotion`). Sin un doble acá, cualquier
 * render de un shell explota antes de llegar a la aserción.
 *
 * El default es "no matchea": desktop, sin `prefers-reduced-motion`, no instalada. Los
 * tests que necesitan otra cosa la sobreescriben con `stubMatchMedia`.
 */
export function stubMatchMedia(matcher: (query: string) => boolean = () => false) {
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>()
  const overrides = new Map<string, boolean>()

  const impl = vi.fn().mockImplementation((query: string) => ({
    // Getter, no valor fijo: la app relee `media.matches` sobre el MISMO objeto cada
    // vez que sincroniza (rotación, resize). Congelarlo en el momento de la creación
    // haría que ningún test pudiera simular un cambio de viewport.
    get matches() {
      return overrides.get(query) ?? matcher(query)
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      const set = listeners.get(query) ?? new Set()
      set.add(listener)
      listeners.set(query, set)
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.get(query)?.delete(listener)
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))

  vi.stubGlobal('matchMedia', impl)
  window.matchMedia = impl as unknown as typeof window.matchMedia

  return {
    /** Dispara el evento `change` de una media query, como una rotación de pantalla. */
    emitChange(query: string, matches: boolean) {
      overrides.set(query, matches)
      for (const listener of listeners.get(query) ?? []) {
        listener({ matches, media: query } as MediaQueryListEvent)
      }
    },
  }
}

/** `IntersectionObserver` tampoco existe en jsdom. Devuelve un control para simular
 * que el elemento entró en pantalla, que es lo único que la app le pide. */
export function stubIntersectionObserver() {
  const instances: { callback: IntersectionObserverCallback; elements: Element[]; disconnected: boolean }[] = []

  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root = null
    readonly rootMargin = ''
    readonly scrollMargin = ''
    readonly thresholds: readonly number[] = []
    readonly callback: IntersectionObserverCallback
    private readonly record: (typeof instances)[number]

    // Campos declarados a mano y no como parámetros del constructor: el proyecto
    // compila con `erasableSyntaxOnly`, que prohíbe esa sintaxis de TypeScript.
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
      this.record = { callback, elements: [], disconnected: false }
      instances.push(this.record)
    }

    observe(element: Element) {
      this.record.elements.push(element)
    }

    unobserve(element: Element) {
      this.record.elements = this.record.elements.filter((item) => item !== element)
    }

    disconnect() {
      this.record.disconnected = true
      this.record.elements = []
    }

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

  return {
    instances,
    /** Hace "entrar en pantalla" a todos los elementos observados. */
    triggerIntersect(isIntersecting = true) {
      for (const instance of instances) {
        if (instance.disconnected) {
          continue
        }
        instance.callback(
          instance.elements.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry),
          {} as IntersectionObserver,
        )
      }
    },
  }
}

/**
 * jsdom no implementa `Blob.arrayBuffer()` ni `Blob.text()`, y el parser lee el export
 * justamente así (`file.arrayBuffer()` para poder olfatear la firma "PK" del zip). Se
 * completan con `FileReader`, que jsdom sí tiene, en vez de reemplazar `File` por el de
 * Node — cambiar la clase rompería los `instanceof File` de `shareTargetFile`.
 */
type BlobPolyfill = Blob & {
  arrayBuffer?: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}

function readBlob<T extends ArrayBuffer | string>(blob: Blob, as: 'buffer' | 'text'): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as T)
    reader.onerror = () => reject(reader.error)
    if (as === 'buffer') {
      reader.readAsArrayBuffer(blob)
    } else {
      reader.readAsText(blob)
    }
  })
}

const blobPrototype = Blob.prototype as BlobPolyfill

if (!blobPrototype.arrayBuffer) {
  blobPrototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return readBlob<ArrayBuffer>(this, 'buffer')
  }
}

if (!blobPrototype.text) {
  blobPrototype.text = function text(this: Blob) {
    return readBlob<string>(this, 'text')
  }
}

// También en el momento de cargar el setup, no sólo en cada `beforeEach`: algunos
// módulos consultan `matchMedia` al importarse (por ejemplo `MetricCard.tsx`, que
// resuelve `prefersReducedMotion()` una sola vez a nivel de módulo), y para entonces
// ningún hook de test corrió todavía.
stubMatchMedia()

beforeEach(() => {
  stubMatchMedia()
  // `crypto.subtle` existe en Node 20+ pero jsdom no lo expone en `window` por defecto.
  if (!globalThis.crypto?.subtle) {
    vi.stubGlobal('crypto', webcrypto)
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
