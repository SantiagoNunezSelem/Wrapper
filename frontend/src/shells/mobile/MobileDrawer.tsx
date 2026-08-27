import { useModalDismiss } from '../../components/useModalDismiss'
import type { ShellCopy } from '../../copy/shellCopy'
import { usePwaInstall } from '../../lib/usePwaInstall'
import type { Language, UserProfile } from '../../types'
import { ChartIcon, CrownIcon, FolderIcon, GlobeIcon, HomeIcon, InstallIcon, ShieldIcon, SignOutIcon } from './icons'
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
  if (!open) {
    return null
  }

  return (
    <DrawerPanel
      copy={copy}
      language={language}
      user={user}
      activeTab={activeTab}
      hasAnalysis={hasAnalysis}
      subscriptionLabel={subscriptionLabel}
      onClose={onClose}
      onNavigate={onNavigate}
      onToggleLanguage={onToggleLanguage}
      onManageSubscription={onManageSubscription}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
    />
  )
}

/* El panel se separó del componente de arriba para que `useModalDismiss` se monte
   y se desmonte con el menú: un hook no puede correr detrás de un `if (!open)`, y
   es justo el momento de abrir el que tiene que mover el foco adentro. */
function DrawerPanel({
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
  /* Escape cierra, el fondo no scrollea (si no, el dedo arrastra la página de atrás
     en vez del menú) y el foco queda adentro — todo compartido con el resto de los
     diálogos, en vez de reimplementado acá. */
  const panelRef = useModalDismiss<HTMLDivElement>(onClose)

  /* Instalar la app estaba escondido en un paso del tutorial de exportación: quien
     ya sabe exportar nunca lo veía. Y sin instalar no existe el "compartir a
     Vistazo" desde WhatsApp, que es para lo que está toda la plomería del
     share_target. Sólo aparece cuando el navegador tiene el prompt listo. */
  const { canInstall, install } = usePwaInstall()

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
          {canInstall ? (
            <DrawerItem
              icon={<InstallIcon size={17} />}
              label={copy.installApp}
              onClick={() => {
                void install()
              }}
            />
          ) : null}
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
