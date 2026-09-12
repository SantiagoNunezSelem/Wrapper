/**
 * Estimación best-effort del SO del visitante a partir del user agent — sólo
 * para elegir qué tutorial de exportación (iOS/Android) abre por defecto, nunca
 * para nada sensible a seguridad. Desktop y cualquier cosa que no sea claramente
 * un iPhone/iPad cae en Android, que es lo que tiene la mayoría de quienes usan
 * el wrapper desde el celular.
 */
export function detectDefaultTutorialPlatform(): 'ios' | 'android' {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android'
}
