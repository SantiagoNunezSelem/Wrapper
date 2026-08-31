const DB_NAME = 'vistazo-share'
const STORE = 'files'
const KEY = 'pending'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

interface SharedFileRecord {
  file: File | null
  debug?: Record<string, unknown>
}

/**
 * Lee el archivo que `sw.js` guardó al recibir un share-target de WhatsApp, y lo
 * borra en el mismo paso — se consume una sola vez, así una recarga después no
 * vuelve a disparar el mismo análisis ni deja un archivo fantasma en la base.
 *
 * `debug` viaja siempre que hubo un intento de share, incluso cuando `file` es
 * null — es lo que `sw.js` pudo ver del POST real (nombre, tipo, tamaño, o el
 * error si algo falló), para diagnosticar sin depender de cazar la consola del
 * service worker en el momento exacto del share.
 */
export async function takeSharedFile(): Promise<SharedFileRecord> {
  const db = await openDb()

  const record = await new Promise<SharedFileRecord>((resolve, reject) => {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    const getRequest = store.get(KEY)

    getRequest.onsuccess = () => {
      store.delete(KEY)
      const stored = getRequest.result as SharedFileRecord | File | undefined
      // Compat con lo que guardaba una versión anterior de sw.js: el File suelto,
      // sin envolver en { file, debug }.
      if (stored instanceof File) {
        resolve({ file: stored })
      } else {
        resolve(stored ?? { file: null })
      }
    }
    getRequest.onerror = () => reject(getRequest.error)
  })

  db.close()
  return record
}
