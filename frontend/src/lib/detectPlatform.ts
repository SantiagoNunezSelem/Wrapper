/**
 * El tutorial de exportación para iOS todavía no está listo. Mientras esto sea
 * `false`, el tutorial abre siempre en Android y el selector iOS/Android no se
 * muestra (con una sola opción no hay nada que elegir). Para habilitarlo, alcanza
 * con pasarlo a `true`: el código de iOS sigue entero en los dos tutoriales.
 */
export const isIosTutorialEnabled = false

/**
 * Estimación best-effort del SO del visitante a partir del user agent — sólo
 * para elegir qué tutorial de exportación (iOS/Android) abre por defecto, nunca
 * para nada sensible a seguridad. Desktop y cualquier cosa que no sea claramente
 * un iPhone/iPad cae en Android, que es lo que tiene la mayoría de quienes usan
 * el wrapper desde el celular.
 */
export function detectDefaultTutorialPlatform(): 'ios' | 'android' {
  return isIosTutorialEnabled && /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android'
}
