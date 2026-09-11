import { request, requestBlob } from '../lib/api'
import type {
  AdminAiReport,
  AdminBusiness,
  AdminInvoicePage,
  AdminNote,
  AdminProductReport,
  AdminSystemReport,
  AdminUrgencies,
  AdminUserDetail,
  AdminUserPage,
} from './types'

/*
 * Las llamadas del panel viven acá y no en lib/api.ts a propósito: este archivo sólo se
 * importa desde el chunk del admin, así que un usuario común nunca las descarga.
 */

export function getAdminBusiness(token: string, days: number): Promise<AdminBusiness> {
  return request<AdminBusiness>(`/api/admin/business?days=${days}`, { method: 'GET' }, token)
}

export function getAdminUrgencies(token: string): Promise<AdminUrgencies> {
  return request<AdminUrgencies>('/api/admin/urgencies', { method: 'GET' }, token)
}

export function searchAdminUsers(token: string, query: string, page: number): Promise<AdminUserPage> {
  const params = new URLSearchParams({ page: String(page) })
  if (query.trim()) {
    params.set('q', query.trim())
  }
  return request<AdminUserPage>(`/api/admin/users?${params.toString()}`, { method: 'GET' }, token)
}

export function getAdminUser(token: string, id: string): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'GET' }, token)
}

/** Vuelve a leer la cuenta desde Mercado Pago. No mueve plata: sólo pone al día la fila local. */
export function syncAdminUser(token: string, id: string): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}/sync`, { method: 'POST' }, token)
}

/** Una nota interna sobre la cuenta. Sólo la ve el panel, y queda en el registro de acciones. */
export function addAdminNote(token: string, id: string, text: string): Promise<AdminNote> {
  return request<AdminNote>(
    `/api/admin/users/${encodeURIComponent(id)}/notes`,
    { method: 'POST', body: JSON.stringify({ text }) },
    token,
  )
}

export function getAdminInvoices(token: string, status: string | null, page: number): Promise<AdminInvoicePage> {
  const params = new URLSearchParams({ page: String(page) })
  if (status) {
    params.set('status', status)
  }
  return request<AdminInvoicePage>(`/api/admin/invoices?${params.toString()}`, { method: 'GET' }, token)
}

export function getAdminAi(token: string, days: number): Promise<AdminAiReport> {
  return request<AdminAiReport>(`/api/admin/ai?days=${days}`, { method: 'GET' }, token)
}

export function getAdminProduct(token: string, days: number): Promise<AdminProductReport> {
  return request<AdminProductReport>(`/api/admin/product?days=${days}`, { method: 'GET' }, token)
}

export function getAdminSystem(token: string): Promise<AdminSystemReport> {
  return request<AdminSystemReport>('/api/admin/system', { method: 'GET' }, token)
}

export type AdminExport = 'users' | 'invoices'

/** El CSV entero, como archivo. Cada descarga queda en el registro de acciones del panel. */
export function getAdminExport(token: string, kind: AdminExport): Promise<Blob> {
  return requestBlob(`/api/admin/export/${kind}.csv`, token)
}
