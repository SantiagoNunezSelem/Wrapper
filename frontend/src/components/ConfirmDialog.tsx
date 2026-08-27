import { ModalShell } from './ModalShell'

export interface ConfirmDialogCopy {
  title: string
  body: string
  confirm: string
  cancel: string
  busy: string
  close: string
}

/**
 * La confirmación de una acción que no se puede deshacer.
 *
 * Genérica a propósito: el borrado de un análisis es la primera que la usa, pero
 * el patrón —título, una línea de contexto, cancelar a la izquierda y la acción
 * destructiva a la derecha— es el mismo que ya tenía `FreeUnlockConfirm`, y no
 * hacía falta un tercer modal escrito a mano para la siguiente.
 */
export function ConfirmDialog({
  copy,
  isBusy = false,
  onConfirm,
  onCancel,
}: {
  copy: ConfirmDialogCopy
  isBusy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ModalShell onDismiss={onCancel} label={copy.title} className="confirm-modal" closeLabel={copy.close}>
      <h2>{copy.title}</h2>
      <p className="panel-copy">{copy.body}</p>

      <div className="free-unlock-actions">
        <button type="button" className="ghost-button" onClick={onCancel} disabled={isBusy}>
          {copy.cancel}
        </button>
        <button type="button" className="primary-button is-danger" onClick={onConfirm} disabled={isBusy}>
          {isBusy ? copy.busy : copy.confirm}
        </button>
      </div>
    </ModalShell>
  )
}
