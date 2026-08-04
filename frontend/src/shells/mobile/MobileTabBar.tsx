import type { ShellCopy } from '../../copy/shellCopy'
import { ChartIcon, FolderIcon, HomeIcon, PlusIcon, UserIcon } from './icons'

export type MobileTab = 'home' | 'metrics' | 'history' | 'account'

/**
 * La barra fija de abajo. Cuatro destinos y el botón de subir al medio.
 *
 * El `+` va acá y no en el topbar porque subir un chat es la acción principal
 * de la app: tiene que estar siempre a un pulgar de distancia, en la zona más
 * cómoda de la pantalla. Va elevado sobre la barra con una muesca del color del
 * fondo, para que se lea como un botón flotante y no como una quinta pestaña.
 */
export function MobileTabBar({
  active,
  copy,
  hasAnalysis,
  onSelect,
  onUpload,
}: {
  active: MobileTab
  copy: ShellCopy['mobile']
  /** Sin un chat cargado la pestaña de métricas no lleva a ningún lado, así que
   * se atenúa en vez de desaparecer: que el destino exista es parte de entender
   * la app, aunque hoy esté vacío. */
  hasAnalysis: boolean
  onSelect: (tab: MobileTab) => void
  onUpload: () => void
}) {
  const tabs = [
    { id: 'home' as const, label: copy.tabs.home, Icon: HomeIcon, enabled: true },
    { id: 'metrics' as const, label: copy.tabs.metrics, Icon: ChartIcon, enabled: hasAnalysis },
    { id: 'history' as const, label: copy.tabs.history, Icon: FolderIcon, enabled: true },
    { id: 'account' as const, label: copy.tabs.account, Icon: UserIcon, enabled: true },
  ]

  return (
    <nav className="m-tabbar">
      {tabs.slice(0, 2).map((tab) => (
        <TabButton key={tab.id} tab={tab} active={active} onSelect={onSelect} />
      ))}

      <button type="button" className="m-fab" onClick={onUpload} aria-label={copy.uploadAction}>
        <PlusIcon />
      </button>

      {tabs.slice(2).map((tab) => (
        <TabButton key={tab.id} tab={tab} active={active} onSelect={onSelect} />
      ))}
    </nav>
  )
}

function TabButton({
  tab,
  active,
  onSelect,
}: {
  tab: { id: MobileTab; label: string; Icon: (props: { size?: number }) => React.ReactElement; enabled: boolean }
  active: MobileTab
  onSelect: (tab: MobileTab) => void
}) {
  const isActive = active === tab.id

  return (
    <button
      type="button"
      className={`m-tab ${isActive ? 'is-active' : ''} ${tab.enabled ? '' : 'is-empty'}`}
      onClick={() => onSelect(tab.id)}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="m-tab-icon">
        <tab.Icon size={21} />
      </span>
      <span className="m-tab-label">{tab.label}</span>
    </button>
  )
}
