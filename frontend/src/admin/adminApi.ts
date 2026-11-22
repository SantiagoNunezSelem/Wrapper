import { request, requestBlob, requestNoContent } from '../lib/api'
import type {
  AdminAiReport,
  AdminBusiness,
  AdminCampaign,
  AdminCampaignUser,
  AdminInvoicePage,
  AdminNote,
  AdminProductReport,
  AdminSupportReport,
  AdminSupportReportPage,
  AdminSystemReport,
  AdminUrgencies,
  AdminUserDetail,
  AdminUserPage,
  SupportReportStatus,
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

export function getAdminSupportReports(token: string, status: SupportReportStatus | null, page: number): Promise<AdminSupportReportPage> {
  const params = new URLSearchParams({ page: String(page) })
  if (status) {
    params.set('status', status)
  }
  return request<AdminSupportReportPage>(`/api/admin/support-reports?${params.toString()}`, { method: 'GET' }, token)
}

/** Lo marca resuelto o lo vuelve a "nuevo". Queda en el registro de acciones del panel. */
export function setAdminSupportReportStatus(token: string, id: string, status: SupportReportStatus): Promise<AdminSupportReport> {
  return request<AdminSupportReport>(
    `/api/admin/support-reports/${encodeURIComponent(id)}/status`,
    { method: 'POST', body: JSON.stringify({ status }) },
    token,
  )
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

/** Duraciones del VIP que ofrece el panel. `null` es sin vencimiento. */
export type AdminVipDays = 7 | 30 | 90 | null

/** Pro sin cobro. Si ya tiene Pro de regalo, se suma a lo que le queda. */
export function grantAdminVip(token: string, id: string, days: AdminVipDays): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(
    `/api/admin/users/${encodeURIComponent(id)}/vip`,
    { method: 'POST', body: JSON.stringify(days === null ? { forever: true } : { days }) },
    token,
  )
}

/** Le saca el Pro ya. Una suscripción que Mercado Pago volvería a cobrar se cancela primero. */
export function revokeAdminVip(token: string, id: string): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}/vip`, { method: 'DELETE' }, token)
}

/** Su próxima suscripción arranca con la semana gratis, aunque su red o su dispositivo ya la hayan usado. */
export function grantAdminTrial(token: string, id: string): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}/trial`, { method: 'POST' }, token)
}

export function getAdminCampaigns(token: string): Promise<AdminCampaign[]> {
  return request<AdminCampaign[]>('/api/admin/campaigns', { method: 'GET' }, token)
}

export function getAdminCampaignUsers(token: string, id: string): Promise<AdminCampaignUser[]> {
  return request<AdminCampaignUser[]>(`/api/admin/campaigns/${encodeURIComponent(id)}/users`, { method: 'GET' }, token)
}

/** Crea la campaña y su link. El código lo elige el servidor y no cambia nunca más. */
export function createAdminCampaign(token: string, title: string): Promise<Pick<AdminCampaign, 'id' | 'code' | 'title'>> {
  return request('/api/admin/campaigns', { method: 'POST', body: JSON.stringify({ title }) }, token)
}

/** Cambia sólo el título: el link impreso sigue siendo el mismo. */
export function renameAdminCampaign(token: string, id: string, title: string): Promise<Pick<AdminCampaign, 'id' | 'code' | 'title'>> {
  return request(`/api/admin/campaigns/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ title }) }, token)
}

/** Borra las visitas (las de prueba, típicamente). Registros y pagos quedan. */
export function resetAdminCampaignVisits(token: string, id: string): Promise<void> {
  return requestNoContent(`/api/admin/campaigns/${encodeURIComponent(id)}/reset-visits`, { method: 'POST' }, token)
}

/** Borra la campaña y sus visitas; las cuentas que trajo quedan sin campaña. */
export function deleteAdminCampaign(token: string, id: string): Promise<void> {
  return requestNoContent(`/api/admin/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }, token)
}

export type AdminExport = 'users' | 'invoices'

/** El CSV entero, como archivo. Cada descarga queda en el registro de acciones del panel. */
export function getAdminExport(token: string, kind: AdminExport): Promise<Blob> {
  return requestBlob(`/api/admin/export/${kind}.csv`, token)
}
