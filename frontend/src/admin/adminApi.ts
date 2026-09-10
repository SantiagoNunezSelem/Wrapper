import { request } from '../lib/api'
import type { AdminBusiness, AdminUrgencies, AdminUserDetail, AdminUserPage } from './types'

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
