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

/**
 * Lee el archivo que `sw.js` guardó al recibir un share-target de WhatsApp, y lo
 * borra en el mismo paso — se consume una sola vez, así una recarga después no
 * vuelve a disparar el mismo análisis ni deja un archivo fantasma en la base.
 */
export async function takeSharedFile(): Promise<File | null> {
  const db = await openDb()

  const file = await new Promise<File | null>((resolve, reject) => {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    const getRequest = store.get(KEY)

    getRequest.onsuccess = () => {
      store.delete(KEY)
      resolve((getRequest.result as File | undefined) ?? null)
    }
    getRequest.onerror = () => reject(getRequest.error)
  })

  db.close()
  return file
}
