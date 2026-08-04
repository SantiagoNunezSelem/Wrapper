/** Formatea un importe con la moneda que devuelve el backend.
 *
 * Vive en su propio módulo porque lo usan la página de suscripción y la vista
 * de cuenta de mobile: dos implementaciones del mismo formato es justo lo que
 * después se desincroniza entre los dos shells.
 *
 * Si el par moneda/locale no es válido, cae a un texto plano en vez de romper
 * la pantalla entera — el precio importa, pero no tanto. */
export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}
