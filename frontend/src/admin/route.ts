import type { AdminSection } from './types'

/*
 * La ruta del panel, en un módulo mínimo aparte: App.tsx la importa para decidir si
 * mostrar el panel, y si viviera junto a AdminApp arrastraría todo el panel al bundle
 * principal que descarga cualquier usuario.
 */

export interface AdminRoute {
  section: AdminSection
  userId: string | null
}

export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

/** `/admin` → negocio · `/admin/urgencias` · `/admin/usuarios` · `/admin/usuarios/{id}`. */
export function parseAdminPath(pathname: string): AdminRoute {
  const parts = pathname.split('/').filter(Boolean)
  const section: AdminSection = parts[1] === 'urgencias' ? 'urgencias' : parts[1] === 'usuarios' ? 'usuarios' : 'negocio'
  const userId = section === 'usuarios' && parts[2] ? decodeURIComponent(parts[2]) : null
  return { section, userId }
}

export function pathFor(route: AdminRoute): string {
  if (route.section === 'negocio') return '/admin'
  if (route.section === 'urgencias') return '/admin/urgencias'
  return route.userId ? `/admin/usuarios/${encodeURIComponent(route.userId)}` : '/admin/usuarios'
}
