// Service worker: requisito de instalabilidad (junto con el manifest, ver
// `usePwaInstall`) y receptor del share-target declarado en `manifest.json`.

const SHARE_DB_NAME = 'vistazo-share'
const SHARE_STORE = 'files'
const SHARE_KEY = 'pending'
const SHARE_TARGET_PATH = '/share-target/'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (event.request.method === 'POST' && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(event.request))
    return
  }

  event.respondWith(fetch(event.request))
})

async function handleShareTarget(request) {
  try {
    const formData = await request.formData()
    const file = formData.get('chat')

    if (file) {
      await storeSharedFile(file)
    }
  } catch {
    // Nada compartido, o el formato vino roto: seguimos igual — la app arranca
    // normal y simplemente no encuentra ningún archivo pendiente que abrir.
  }

  // 303: la única forma de convertir esta navegación POST en un GET normal, así
  // el usuario cae en una URL recargable en vez de quedar atado al formulario.
  return Response.redirect('/?share-target=1', 303)
}

function storeSharedFile(file) {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(SHARE_DB_NAME, 1)

    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore(SHARE_STORE)
    }

    openRequest.onsuccess = () => {
      const db = openRequest.result
      const tx = db.transaction(SHARE_STORE, 'readwrite')
      tx.objectStore(SHARE_STORE).put(file, SHARE_KEY)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }

    openRequest.onerror = () => reject(openRequest.error)
  })
}
