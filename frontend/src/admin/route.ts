import type { AdminSection } from './types'

/*
 * La ruta del panel, en un módulo mínimo aparte: App.tsx la importa para decidir si
 * mostrar el panel, y si viviera junto a AdminApp arrastraría todo el panel al bundle
 * principal que descarga cualquier usuario.
 */

/** Las secciones, en el orden del menú. */
export const ADMIN_SECTIONS: readonly AdminSection[] = ['negocio', 'urgencias', 'usuarios', 'cobros', 'ia', 'producto', 'sistema']

export interface AdminRoute {
  section: AdminSection
  userId: string | null
}

export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

/** `/admin` → negocio · `/admin/{sección}` · `/admin/usuarios/{id}`. Lo desconocido cae en negocio. */
export function parseAdminPath(pathname: string): AdminRoute {
  const parts = pathname.split('/').filter(Boolean)
  const section = ADMIN_SECTIONS.find((item) => item === parts[1]) ?? 'negocio'
  const userId = section === 'usuarios' && parts[2] ? decode(parts[2]) : null
  return { section, userId }
}

export function pathFor(route: AdminRoute): string {
  if (route.section === 'negocio') return '/admin'
  if (route.section === 'usuarios' && route.userId) return `/admin/usuarios/${encodeURIComponent(route.userId)}`
  return `/admin/${route.section}`
}

/** Un `%` suelto pegado en la barra de direcciones no tiene que tirar el panel entero. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
