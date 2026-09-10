import { useEffect, useState } from 'react'
import type { Language, UserProfile } from '../types'
import { adminCopy, type AdminCopy } from '../copy/adminCopy'
import { AdminErrorBoundary } from './AdminErrorBoundary'
import { BusinessSection } from './BusinessSection'
import { parseAdminPath, pathFor, type AdminRoute } from './route'
import type { AdminSection } from './types'
import { UrgenciesSection } from './UrgenciesSection'
import { UsersSection } from './UsersSection'
import './admin.css'

const SECTIONS: AdminSection[] = ['negocio', 'urgencias', 'usuarios']

/**
 * El panel de administración: tres secciones sobre un mismo esqueleto. Negocio para los
 * números, Urgencias para lo que se rompió, Usuarios para una cuenta en particular.
 *
 * Mostrarlo sólo a un admin es comodidad, no seguridad: cada llamada de estas pantallas pasa
 * por el filtro del backend, que vuelve a leer `IsAdmin` de la base.
 */
export function AdminApp({
  token,
  user,
  language,
  onToggleLanguage,
}: {
  token: string | null
  user: UserProfile | null
  language: Language
  onToggleLanguage: () => void
}) {
  const copy = adminCopy[language]
  const [route, setRoute] = useState<AdminRoute>(() => parseAdminPath(window.location.pathname))

  useEffect(() => {
    const onPop = () => setRoute(parseAdminPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    document.title = `${copy.nav[route.section]} · ${copy.title} · Vistazo`
  }, [copy, route.section])

  if (!token) {
    return <Gate copy={copy} message={copy.signInFirst} />
  }

  if (!user) {
    return (
      <div className="adm-gate" role="status">
        <p className="adm-muted">{copy.loading}</p>
      </div>
    )
  }

  if (!user.isAdmin) {
    return <Gate copy={copy} message={copy.forbidden} />
  }

  function go(next: AdminRoute) {
    window.history.pushState(null, '', pathFor(next))
    setRoute(next)
  }

  const openUser = (id: string) => go({ section: 'usuarios', userId: id })

  return (
    <div className="adm-app">
      <aside className="adm-side">
        <a className="adm-brand" href="/">
          <span className="adm-orb" aria-hidden="true" />
          Vistazo <span className="adm-tag">admin</span>
        </a>
        <nav className="adm-nav" aria-label={copy.title}>
          {SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              className={`adm-nav-item${route.section === section ? ' is-on' : ''}`}
              aria-current={route.section === section ? 'page' : undefined}
              onClick={() => go({ section, userId: null })}
            >
              {copy.nav[section]}
            </button>
          ))}
        </nav>
        <div className="adm-side-foot">
          <span className="adm-faint">{user.email}</span>
          <div className="adm-side-links">
            <button type="button" className="adm-link" onClick={onToggleLanguage}>
              {language === 'es' ? 'EN' : 'ES'}
            </button>
            <a className="adm-link" href="/">
              {copy.backToApp}
            </a>
          </div>
        </div>
      </aside>

      <main className="adm-main">
        <h1 className="adm-title">{route.section === 'urgencias' ? copy.urgencies.title : copy.nav[route.section]}</h1>
        <AdminErrorBoundary
          resetKey={`${route.section}:${route.userId ?? ''}`}
          fallback={(retry) => (
            <div className="adm-card adm-error" role="alert">
              <p>{copy.sectionCrashed}</p>
              <button type="button" className="adm-button" onClick={retry}>
                {copy.retry}
              </button>
            </div>
          )}
        >
          {route.section === 'negocio' ? <BusinessSection token={token} language={language} copy={copy} onOpenUser={openUser} /> : null}
          {route.section === 'urgencias' ? <UrgenciesSection token={token} language={language} copy={copy} onOpenUser={openUser} /> : null}
          {route.section === 'usuarios' ? (
            <UsersSection token={token} language={language} copy={copy} userId={route.userId} onSelectUser={openUser} />
          ) : null}
        </AdminErrorBoundary>
      </main>
    </div>
  )
}

function Gate({ copy, message }: { copy: AdminCopy; message: string }) {
  return (
    <div className="adm-gate">
      <div className="adm-card adm-gate-card">
        <p>{message}</p>
        <a className="adm-button is-primary" href="/">
          {copy.goHome}
        </a>
      </div>
    </div>
  )
}
