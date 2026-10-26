import { useId, useState } from 'react'
import { termsUpdatedOn } from '../lib/terms'
import { lazyPanel } from './lazyPanel'
import { ModalShell } from './ModalShell'

// El texto entero sólo se baja cuando alguien toca "Ver términos y condiciones": quien
// acepta sin leerlos, que es la mayoría, nunca descarga ni dibuja las veinte secciones.
const TermsDocument = lazyPanel(() => import('./TermsDocument'), (m) => m.TermsDocument)

export interface TermsModalCopy {
  eyebrow: string
  title: string
  intro: string
  viewTerms: string
  hideTerms: string
  checkbox: string
  accept: string
  accepting: string
  signOut: string
  updatedOn: string
  languageNote: string
}

/**
 * El cartel de términos: aparece una sola vez por cuenta, apenas inicia sesión, y no se
 * cierra. Las únicas salidas son aceptar o cerrar la sesión — sin aceptación no hay cuenta
 * que usar, pero tampoco se encierra a nadie en un cartel sin salida.
 *
 * Es corto a propósito: un aviso, la casilla y los dos botones. El texto completo está a un
 * link de distancia y se despliega acá mismo, en el cartel, en vez de abrir otra página: una
 * página nueva sacaría a la persona del cartel que todavía tiene que contestar.
 */
export function TermsModal({
  copy,
  isBusy,
  error,
  onAccept,
  onSignOut,
}: {
  copy: TermsModalCopy
  isBusy: boolean
  error: string
  onAccept: () => void
  onSignOut: () => void
}) {
  const checkboxId = useId()
  const textId = useId()
  const [checked, setChecked] = useState(false)
  const [isTextOpen, setIsTextOpen] = useState(false)

  return (
    // Escape y el click afuera no hacen nada: no hay "cerrar" que no sea una de las dos respuestas.
    <ModalShell onDismiss={() => undefined} label={copy.title} className={`terms-modal${isTextOpen ? ' is-expanded' : ''}`}>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h2>{copy.title}</h2>
      <p className="panel-copy">{copy.intro}</p>

      <button
        type="button"
        className="terms-modal-link"
        aria-expanded={isTextOpen}
        aria-controls={textId}
        onClick={() => setIsTextOpen((open) => !open)}
      >
        {isTextOpen ? copy.hideTerms : copy.viewTerms}
      </button>

      {isTextOpen ? (
        <div id={textId} className="terms-modal-scroll" tabIndex={0} role="region" aria-label={copy.title}>
          <p className="terms-modal-updated">{copy.updatedOn.replace('{date}', termsUpdatedOn())}</p>
          {copy.languageNote ? <p className="terms-modal-updated">{copy.languageNote}</p> : null}
          <TermsDocument headingLevel="h3" />
        </div>
      ) : null}

      <label className="terms-modal-check" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          disabled={isBusy}
        />
        <span>{copy.checkbox}</span>
      </label>

      {error ? (
        <p className="subpage-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="consent-actions">
        <button type="button" className="primary-button" onClick={onAccept} disabled={!checked || isBusy}>
          {isBusy ? copy.accepting : copy.accept}
        </button>
        <button type="button" className="ghost-button" onClick={onSignOut} disabled={isBusy}>
          {copy.signOut}
        </button>
      </div>
    </ModalShell>
  )
}
