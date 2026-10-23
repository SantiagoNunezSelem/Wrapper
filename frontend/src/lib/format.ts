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

/** El medio de pago tal como lo guarda Mercado Pago (`account_money`, `visa ···· 6411`),
 * vuelto algo que se lee: "Dinero en cuenta", "Visa ···· 6411". Sólo para mostrar: el
 * backend sigue guardando y mandando el id crudo.
 *
 * Un id que no está en `names` sale con mayúscula inicial en vez de perderse. */
export function formatPaymentMethod(label: string | null, names: Record<string, string>): string | null {
  if (!label) {
    return null
  }
  const [id, ...rest] = label.split(' ')
  const name = names[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
  return [name, ...rest].join(' ')
}

const LEADING_EMOJI =/^(\p{Extended_Pictographic}️?)\s*/u

/** Separa un emoji inicial (p. ej. "😂 ×1.243") del resto del texto.
 *
 * `.gradient-text` pinta el texto con `background-clip: text` + `color:
 * transparent`, y eso se lleva puesto cualquier glifo que contenga, emoji
 * incluido: el navegador lo pinta plano con el color/gradiente del texto en
 * vez de sus colores propios. Sacar el emoji a un elemento aparte (fuera de
 * `.gradient-text`) es lo que le devuelve su color nativo. */
export function splitLeadingEmoji(text: string): { emoji: string | null; rest: string } {
  const match = LEADING_EMOJI.exec(text)
  return match ? { emoji: match[1], rest: text.slice(match[0].length) } : { emoji: null, rest: text }
}
