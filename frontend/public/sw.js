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
  // Diagnóstico de qué llegó realmente en el POST — se guarda siempre, haya
  // archivo o no, y la app lo loguea al arrancar. Es la única forma práctica de
  // ver, desde el lado del cliente, si WhatsApp/Android entregaron el stream
  // completo o si esto nunca tuvo bytes reales para empezar.
  const debug = { receivedAt: new Date().toISOString() }

  try {
    const formData = await request.formData()
    const file = formData.get('chat')
    const text = formData.get('text')

    debug.fieldPresent = formData.has('chat')

    if (file instanceof File) {
      debug.name = file.name
      debug.type = file.type
      debug.size = file.size
    } else if (typeof file === 'string') {
      // Algunos remitentes mandan el campo como texto plano en vez de stream —
      // esto lo distingue de un File real en vez de fallar silenciosamente.
      debug.receivedAsText = true
      debug.textLength = file.length
    }

    // Declarado aparte en el manifest (params.text): si WhatsApp manda EXTRA_TEXT
    // junto con el adjunto real (como en un intent tipo "compartir por email"), esto
    // debería quedarse con ese texto y dejar `chat` libre para el archivo de verdad.
    if (typeof text === 'string' && text.length > 0) {
      debug.text = text.slice(0, 300)
    }

    await storeSharedFile(file instanceof File && file.size > 0 ? file : null, debug)
  } catch (err) {
    debug.error = err instanceof Error ? err.message : String(err)
    await storeSharedFile(null, debug).catch(() => {})
  }

  // 303: la única forma de convertir esta navegación POST en un GET normal, así
  // el usuario cae en una URL recargable en vez de quedar atado al formulario.
  return Response.redirect('/?share-target=1', 303)
}

function storeSharedFile(file, debug) {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(SHARE_DB_NAME, 1)

    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore(SHARE_STORE)
    }

    openRequest.onsuccess = () => {
      const db = openRequest.result
      const tx = db.transaction(SHARE_STORE, 'readwrite')
      tx.objectStore(SHARE_STORE).put({ file, debug }, SHARE_KEY)
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
