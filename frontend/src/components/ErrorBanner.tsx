/**
 * El aviso de error de arriba de la pantalla, compartido por los dos shells.
 *
 * Antes era un `<p className="error-banner">` pelado: un lector de pantalla nunca
 * se enteraba de que había aparecido, y una vez visible no había forma de sacarlo
 * —quedaba ahí hasta que otra acción limpiara el estado—. Con `role="alert"` se
 * anuncia solo, y la × lo descarta.
 */
export function ErrorBanner({
  message,
  dismissLabel,
  onDismiss,
  className = '',
}: {
  message: string
  dismissLabel: string
  onDismiss: () => void
  className?: string
}) {
  return (
    <div className={`error-banner ${className}`} role="alert">
      <p className="error-banner-text">{message}</p>
      <button type="button" className="error-banner-close" onClick={onDismiss} aria-label={dismissLabel}>
        ✕
      </button>
    </div>
  )
}
