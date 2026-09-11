import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addAdminNote,
  getAdminAi,
  getAdminBusiness,
  getAdminExport,
  getAdminInvoices,
  getAdminProduct,
  getAdminSystem,
  getAdminUrgencies,
  getAdminUser,
  searchAdminUsers,
  syncAdminUser,
} from '../adminApi'

const BASE = 'http://localhost:5175'

let fetchMock: ReturnType<typeof vi.fn>

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined]
  return { url, method: init?.method, body: init?.body, headers: (init?.headers ?? {}) as Record<string, string> }
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API del panel', () => {
  it('pide el negocio con la ventana elegida y el token', async () => {
    await getAdminBusiness('tok', 7)

    const call = lastCall()
    expect(call.url).toBe(`${BASE}/api/admin/business?days=7`)
    expect(call.method).toBe('GET')
    expect(call.headers.Authorization).toBe('Bearer tok')
  })

  it('pide las urgencias', async () => {
    await getAdminUrgencies('tok')

    expect(lastCall().url).toBe(`${BASE}/api/admin/urgencies`)
  })

  it('una búsqueda vacía no manda el parámetro q', async () => {
    await searchAdminUsers('tok', '   ', 2)

    expect(lastCall().url).toBe(`${BASE}/api/admin/users?page=2`)
  })

  it('una búsqueda con texto lo manda recortado y codificado', async () => {
    await searchAdminUsers('tok', ' lucía@ex.com ', 1)

    expect(lastCall().url).toBe(`${BASE}/api/admin/users?page=1&q=luc%C3%ADa%40ex.com`)
  })

  it('pide la ficha y la sincronización por id', async () => {
    await getAdminUser('tok', 'u 1')
    expect(lastCall().url).toBe(`${BASE}/api/admin/users/u%201`)

    await syncAdminUser('tok', 'u-1')
    const call = lastCall()
    expect(call.url).toBe(`${BASE}/api/admin/users/u-1/sync`)
    expect(call.method).toBe('POST')
  })

  it('manda la nota por POST, como JSON', async () => {
    await addAdminNote('tok', 'u 1', 'Pidió factura.')

    const call = lastCall()
    expect(call.url).toBe(`${BASE}/api/admin/users/u%201/notes`)
    expect(call.method).toBe('POST')
    expect(JSON.parse(String(call.body))).toEqual({ text: 'Pidió factura.' })
  })

  it('pide los cobros por página y, si hay, por estado', async () => {
    await getAdminInvoices('tok', null, 2)
    expect(lastCall().url).toBe(`${BASE}/api/admin/invoices?page=2`)

    await getAdminInvoices('tok', 'rechazado', 1)
    expect(lastCall().url).toBe(`${BASE}/api/admin/invoices?page=1&status=rechazado`)
  })

  it('pide IA y producto con la ventana elegida, y el sistema', async () => {
    await getAdminAi('tok', 7)
    expect(lastCall().url).toBe(`${BASE}/api/admin/ai?days=7`)

    await getAdminProduct('tok', 90)
    expect(lastCall().url).toBe(`${BASE}/api/admin/product?days=90`)

    await getAdminSystem('tok')
    expect(lastCall().url).toBe(`${BASE}/api/admin/system`)
  })

  it('baja el CSV como archivo, con el token', async () => {
    const file = new Blob(['id,email'])
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => file })

    await expect(getAdminExport('tok', 'invoices')).resolves.toBe(file)

    const call = lastCall()
    expect(call.url).toBe(`${BASE}/api/admin/export/invoices.csv`)
    expect(call.headers.Authorization).toBe('Bearer tok')
  })

  it('si el CSV falla, devuelve el mensaje del backend y no un archivo roto', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '{"message":"No existe.","code":"not_found"}' })

    await expect(getAdminExport('tok', 'users')).rejects.toMatchObject({ message: 'No existe.', status: 404, code: 'not_found' })
  })
})
