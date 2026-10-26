/**
 * La barra de arriba de las páginas sueltas (ayuda, términos): volver a la app y el
 * cambio de idioma. Es la misma que dibuja la de suscripción, con las mismas clases.
 */
export function SubpageHeader({
  language,
  backLabel,
  onBack,
  onLanguageToggle,
}: {
  language: 'es' | 'en'
  backLabel: string
  onBack: () => void
  onLanguageToggle: () => void
}) {
  return (
    <header className="subpage-header">
      <button type="button" className="subpage-back" onClick={onBack} aria-label={backLabel}>
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span className="subpage-back-label">{backLabel}</span>
      </button>

      <div className="subpage-header-actions">
        <button type="button" className="ghost-button" onClick={onLanguageToggle}>
          {language === 'es' ? 'EN' : 'ES'}
        </button>
      </div>
    </header>
  )
}
