import type { Language } from '../types'
import type { AdminCopy } from '../copy/adminCopy'
import type { AdminEvent } from './types'

const locale = (language: Language) => (language === 'es' ? 'es-AR' : 'en-US')

/** `{name}` → valor. El texto es del copy; esto sólo llena los huecos. */
export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template)
}

/**
 * Filas anteriores a la columna de moneda la traen en null, y `Intl` con `currency: null`
 * no devuelve un texto raro: tira una excepción que se lleva la pantalla entera. La app sólo
 * cobra en pesos, así que ARS es la lectura correcta de ese null.
 */
export function money(amount: number, currency: string | null | undefined, language: Language): string {
  const code = currency || 'ARS'
  try {
    return new Intl.NumberFormat(locale(language), { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${new Intl.NumberFormat(locale(language)).format(amount)} ${code}`
  }
}

export function count(value: number, language: Language): string {
  return new Intl.NumberFormat(locale(language)).format(value)
}

/** "1,2 M", "48 mil": para tokens, donde la cifra exacta no se lee. */
export function compact(value: number, language: Language): string {
  return new Intl.NumberFormat(locale(language), { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** Dólares con los decimales que hagan falta: la IA de un mes tranquilo cuesta centavos. */
export function usd(amount: number, language: Language): string {
  return new Intl.NumberFormat(locale(language), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: amount > 0 && amount < 1 ? 4 : 2,
  }).format(amount)
}

export function percent(value: number, language: Language): string {
  return new Intl.NumberFormat(locale(language), { style: 'percent', maximumFractionDigits: 0 }).format(value)
}

/** Año con cuatro cifras: el VIP del admin vence en 2099, y "31/12/99" se leía como 1999. */
export function dateShort(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(locale(language), { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(iso))
}

export function dateTime(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(locale(language), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

/** "hace 12 min", "hace 3 h", "hace 2 días" — la unidad más grande que no dé cero. */
export function relative(iso: string, now: number, language: Language): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const format = new Intl.RelativeTimeFormat(locale(language), { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return format.format(seconds, 'second')
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86_400), 'day')
}

/** `2026-09` → "sep". */
export function monthLabel(month: string, language: Language): string {
  const [year, index] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(locale(language), { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, index - 1, 1)))
    .replace('.', '')
}

/**
 * Lo que guarda la app es el id de Mercado Pago (`account_money`, `visa ···· 6411`). Acá se
 * vuelve algo que se lee: "Dinero en cuenta", "Visa ···· 6411".
 */
export function paymentMethod(label: string | null, copy: AdminCopy): string | null {
  if (!label) {
    return null
  }
  const [id, ...rest] = label.split(' ')
  const name = copy.paymentMethods[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
  return [name, ...rest].join(' ')
}

/**
 * Una línea de la actividad, contada en castellano. Lo técnico (tópico, acción, notas tal
 * cual las guardó el backend) queda para el detalle técnico.
 */
export function describeEvent(event: AdminEvent, copy: AdminCopy): string {
  const e = copy.events
  const notes = event.notes ?? ''

  switch (event.topic) {
    case 'checkout':
      return event.action === 'trial' ? e.checkoutTrial : event.action === 'no_trial' ? e.checkoutNoTrial : e.checkout
    case 'subscription_preapproval':
    case 'preapproval':
      return e.preapproval
    case 'subscription_authorized_payment':
    case 'authorized_payment':
    case 'payment':
      return notes.startsWith('approved') ? e.paymentApproved : notes.startsWith('rejected') ? e.paymentRejected : e.paymentUpdate
    case 'cancel':
      return e.cancel
    case 'pause':
      return e.pause
    case 'resume':
      return e.resume
    case 'sync':
      return e.sync
    case 'reconcile':
      return e.reconcile
    case 'dev':
      return e.dev
    default:
      return e.other
  }
}
