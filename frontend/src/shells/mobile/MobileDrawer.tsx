import { useEffect, useRef } from 'react'
import type { ShellCopy } from '../../copy/shellCopy'
import type { Language, UserProfile } from '../../types'
import { ChartIcon, CrownIcon, FolderIcon, GlobeIcon, HomeIcon, ShieldIcon, SignOutIcon } from './icons'
import type { MobileTab } from './MobileTabBar'

/**
 * El menú hamburguesa.
 *
 * Absorbe todo lo que en desktop pelea por el topbar —idioma, cuenta,
 * suscripción, cerrar sesión— más el texto de privacidad que allá vive en el
 * pie. En un teléfono ese pie queda al final de un scroll largo y nadie lo lee;
 * acá está a un toque.
 */
export function MobileDrawer({
  open,
  copy,
  language,
  user,
  activeTab,
  hasAnalysis,
  subscriptionLabel,
  onClose,
  onNavigate,
  onToggleLanguage,
  onManageSubscription,
  onSignIn,
  onSignOut,
}: {
  open: boolean
  copy: ShellCopy
  language: Language
  user: UserProfile | null
  activeTab: MobileTab
  hasAnalysis: boolean
  subscriptionLabel: string
  onClose: () => void
  onNavigate: (tab: MobileTab) => void
  onToggleLanguage: () => void
  onManageSubscription: () => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  /* Escape cierra, y mientras está abierto el fondo no scrollea: si no, el dedo
   * arrastra la página de atrás en vez del menú. */
  useEffect(() => {
    if (!open) {
      return
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKey)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  const m = copy.mobile

  return (
    <div className="m-layer" role="dialog" aria-modal="true" aria-label={m.openMenu}>
      <button type="button" className="m-scrim" onClick={onClose} aria-label={m.closeMenu} />

      <div className="m-drawer" ref={panelRef}>
        {user ? (
          <div className="m-drawer-head">
            <span className="m-avatar is-large">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <div className="m-drawer-id">
              <strong>{user.displayName}</strong>
              <span>{user.email}</span>
            </div>
          </div>
        ) : (
          <div className="m-drawer-head is-anon">
            <div className="m-drawer-id">
              <strong>{copy.savePromptTitle}</strong>
              <span>{copy.savePromptBody}</span>
            </div>
          </div>
        )}

        {user ? null : (
          <button type="button" className="primary-button m-drawer-cta" onClick={onSignIn}>
            {copy.login}
          </button>
        )}

        <nav className="m-drawer-nav">
          <DrawerItem icon={<HomeIcon size={17} />} label={m.tabs.home} active={activeTab === 'home'} onClick={() => onNavigate('home')} />
          <DrawerItem
            icon={<ChartIcon size={17} />}
            label={m.drawer.myWrapped}
            active={activeTab === 'metrics'}
            disabled={!hasAnalysis}
            onClick={() => onNavigate('metrics')}
          />
          <DrawerItem icon={<FolderIcon size={17} />} label={m.drawer.savedHistory} active={activeTab === 'history'} onClick={() => onNavigate('history')} />
        </nav>

        <hr className="m-drawer-rule" />

        <nav className="m-drawer-nav">
          <DrawerItem
            icon={<CrownIcon size={15} />}
            label={copy.subscription}
            value={subscriptionLabel}
            highlight={Boolean(user?.hasVipAccess)}
            onClick={onManageSubscription}
          />
          <DrawerItem
            icon={<GlobeIcon size={17} />}
            label={m.drawer.language}
            value={language === 'es' ? 'ES' : 'EN'}
            onClick={onToggleLanguage}
          />
        </nav>

        <hr className="m-drawer-rule" />

        <details className="m-privacy">
          <summary>
            <span className="m-drawer-icon">
              <ShieldIcon size={17} />
            </span>
            {m.drawer.privacy}
          </summary>
          <p>{copy.footerPrivacy}</p>
        </details>

        {user ? (
          <>
            <hr className="m-drawer-rule" />
            <DrawerItem icon={<SignOutIcon size={17} />} label={copy.logout} onClick={onSignOut} />
          </>
        ) : null}

        <p className="m-drawer-foot">
          © {new Date().getFullYear()} Vistazo · {copy.footerRights}
        </p>
      </div>
    </div>
  )
}

function DrawerItem({
  icon,
  label,
  value,
  active = false,
  disabled = false,
  highlight = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value?: string
  active?: boolean
  disabled?: boolean
  highlight?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`m-drawer-item ${active ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="m-drawer-icon">{icon}</span>
      <span className="m-drawer-label">{label}</span>
      {value ? <span className={`m-drawer-value ${highlight ? 'is-on' : ''}`}>{value}</span> : null}
    </button>
  )
}
