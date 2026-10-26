import type { UserProfile } from '../types'

/**
 * La edición vigente de los términos: la fecha del texto de `copy/termsText.ts`.
 *
 * Vive aparte del texto para que el bundle principal —que sólo necesita comparar— no
 * arrastre los términos enteros. Cambiar los términos es cambiar las dos cosas juntas: el
 * texto y esta fecha. Con eso cada cuenta los vuelve a aceptar, una vez.
 */
export const TERMS_VERSION = '2026-10-25'

/** "25 de octubre de 2026": la edición es una fecha, y así se la muestra. */
export function termsUpdatedOn(): string {
  // Mediodía UTC: así la fecha es la misma se formatee en el huso que se formatee.
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${TERMS_VERSION}T12:00:00Z`))
}

/** Una cuenta con sesión que todavía no aceptó esta edición. Sin sesión no se pide nada. */
export function needsTermsAcceptance(user: UserProfile | null): boolean {
  return user !== null && user.acceptedTermsVersion !== TERMS_VERSION
}
