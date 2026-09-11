import { describe, expect, it } from 'vitest'
import { adminCopy } from '../../copy/adminCopy'
import { compact, describeEvent, fill, money, monthLabel, paymentMethod, relative, usd } from '../format'
import { ADMIN_SECTIONS, isAdminPath, parseAdminPath, pathFor } from '../route'
import { niceMax } from '../scale'

const copy = adminCopy.es

describe('plata en el panel', () => {
  it('una moneda nula se lee como pesos en vez de romper la pantalla', () => {
    // Filas anteriores a la columna de moneda la traen en null, e Intl tira una excepción
    // con eso: fue lo que dejaba en blanco la ficha del admin.
    expect(money(7800, null, 'es')).toMatch(/\$\s?7\.800/)
    expect(money(7800, undefined, 'es')).toMatch(/\$\s?7\.800/)
  })

  it('un código de moneda inválido cae a número y código, sin excepción', () => {
    expect(money(7800, 'XXXX', 'es')).toBe('7.800 XXXX')
  })

  it('el gasto de IA muestra centavos en vez de redondearlos a cero', () => {
    expect(usd(0.0003, 'en')).toBe('$0.0003')
    expect(usd(0.24, 'en')).toBe('$0.24')
    expect(usd(12.5, 'en')).toBe('$12.50')
    expect(usd(0, 'en')).toBe('$0.00')
  })

  it('los tokens se abrevian', () => {
    expect(compact(950, 'es')).toBe('950')
    // Según la versión de ICU, en castellano sale "48 mil" o "48 k".
    expect(compact(48_000, 'es')).toMatch(/^48\s?(mil|k)$/)
    expect(compact(1_200_000, 'en')).toBe('1.2M')
  })
})
const event = { id: '1', action: null, resultingStatus: null, notes: null, createdAtUtc: '2026-09-10T00:00:00Z' }

describe('formato del panel', () => {
  it('llena todos los huecos de una plantilla', () => {
    expect(fill('{n} de {n} · {x}', { n: 2, x: 'a' })).toBe('2 de 2 · a')
  })

  it('traduce los medios de pago que guarda Mercado Pago', () => {
    // Lo que se veía en la cuenta era el id crudo: "account_money".
    expect(paymentMethod('account_money', copy)).toBe('Dinero en cuenta')
    expect(paymentMethod('visa ···· 6411', copy)).toBe('Visa ···· 6411')
    expect(paymentMethod('rapipago', copy)).toBe('Rapipago')
    expect(paymentMethod(null, copy)).toBeNull()
  })

  it('cuenta cada tipo de evento en castellano', () => {
    const e = copy.events
    expect(describeEvent({ ...event, topic: 'checkout', action: 'trial' }, copy)).toBe(e.checkoutTrial)
    expect(describeEvent({ ...event, topic: 'checkout', action: 'no_trial' }, copy)).toBe(e.checkoutNoTrial)
    expect(describeEvent({ ...event, topic: 'checkout' }, copy)).toBe(e.checkout)
    expect(describeEvent({ ...event, topic: 'subscription_preapproval' }, copy)).toBe(e.preapproval)
    expect(describeEvent({ ...event, topic: 'subscription_authorized_payment', notes: 'approved/accredited · activa → activa' }, copy)).toBe(e.paymentApproved)
    expect(describeEvent({ ...event, topic: 'payment', notes: 'rejected/cc_rejected_other_reason' }, copy)).toBe(e.paymentRejected)
    expect(describeEvent({ ...event, topic: 'authorized_payment' }, copy)).toBe(e.paymentUpdate)
    expect(describeEvent({ ...event, topic: 'cancel' }, copy)).toBe(e.cancel)
    expect(describeEvent({ ...event, topic: 'pause' }, copy)).toBe(e.pause)
    expect(describeEvent({ ...event, topic: 'resume' }, copy)).toBe(e.resume)
    expect(describeEvent({ ...event, topic: 'sync' }, copy)).toBe(e.sync)
    expect(describeEvent({ ...event, topic: 'reconcile' }, copy)).toBe(e.reconcile)
    expect(describeEvent({ ...event, topic: 'dev' }, copy)).toBe(e.dev)
    expect(describeEvent({ ...event, topic: 'admin', action: 'revoke_access' }, copy)).toBe(e.adminRevoke)
    expect(describeEvent({ ...event, topic: 'admin' }, copy)).toBe(e.admin)
    expect(describeEvent({ ...event, topic: 'algo_nuevo' }, copy)).toBe(e.other)
  })

  it('nombra el mes corto', () => {
    expect(monthLabel('2026-09', 'es')).toMatch(/sep/i)
    expect(monthLabel('2026-09', 'en')).toBe('Sep')
  })

  it('dice cuánto hace con la unidad más grande que no da cero', () => {
    const now = Date.parse('2026-09-10T12:00:00Z')
    expect(relative('2026-09-10T11:59:30Z', now, 'es')).toMatch(/30 segundos/)
    expect(relative('2026-09-10T11:48:00Z', now, 'es')).toMatch(/12 minutos/)
    expect(relative('2026-09-10T09:00:00Z', now, 'es')).toMatch(/3 horas/)
    expect(relative('2026-09-05T12:00:00Z', now, 'es')).toMatch(/5 días/)
  })

  it('redondea el eje a 1, 2 o 5 por potencia de diez', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(6)).toBe(10)
    expect(niceMax(4)).toBe(5)
    expect(niceMax(444600)).toBe(500000)
    expect(niceMax(180000)).toBe(200000)
  })
})

describe('rutas del panel', () => {
  it('reconoce el panel y nada más', () => {
    expect(isAdminPath('/admin')).toBe(true)
    expect(isAdminPath('/admin/usuarios/abc')).toBe(true)
    expect(isAdminPath('/administrador')).toBe(false)
    expect(isAdminPath('/')).toBe(false)
  })

  it('ida y vuelta entre ruta y URL, en cada sección', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(parseAdminPath(pathFor({ section, userId: null }))).toEqual({ section, userId: null })
    }
    expect(parseAdminPath(pathFor({ section: 'usuarios', userId: 'u 1' }))).toEqual({ section: 'usuarios', userId: 'u 1' })
    expect(parseAdminPath('/admin/cualquiera')).toEqual({ section: 'negocio', userId: null })
  })

  it('el id sólo cuenta en usuarios, y uno mal codificado no rompe el panel', () => {
    expect(parseAdminPath('/admin/cobros/u-1')).toEqual({ section: 'cobros', userId: null })
    expect(parseAdminPath('/admin/usuarios/%E0%A4%A')).toEqual({ section: 'usuarios', userId: '%E0%A4%A' })
  })
})
